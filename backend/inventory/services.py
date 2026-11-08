"""Regras de negócio de estoque.

Todo saldo muda exclusivamente por aqui: cada operação gera um registro de
movimentação (unidade, quem, quando, tipo, quantidade) e atualiza o saldo
dentro de uma transação, com bloqueio de linha para evitar condições de
corrida entre o tablet da cozinha e o computador do escritório.
"""

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Ingredient, Movement, StockEntry, StockItem
from .units import IncompatibleUnits, convert

KITCHEN_UNDO_WINDOW = timedelta(minutes=15)


class StockError(Exception):
    """Erro de regra de negócio, exibido ao usuário."""

    def __init__(self, message, code="stock_error", extra=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.extra = extra or {}


def _fmt(q: Decimal) -> str:
    return f"{Decimal(q).normalize():f}".replace(".", ",")


def _lock_stock_item(establishment, ingredient_id) -> StockItem:
    try:
        with transaction.atomic():
            StockItem.objects.get_or_create(establishment=establishment, ingredient_id=ingredient_id)
    except IntegrityError:
        pass  # criado em paralelo por outra requisição
    return (StockItem.objects.select_for_update().select_related("ingredient")
            .get(establishment=establishment, ingredient_id=ingredient_id))


def _apply(*, establishment, ingredient_id, kind, input_quantity, input_unit, user, sign,
           entry=None, total_cost=None, notes="", reversal_of=None, allow_negative=None) -> Movement:
    """Cria uma movimentação e atualiza o saldo. Deve rodar dentro de atomic()."""
    item = _lock_stock_item(establishment, ingredient_id)
    ingredient = item.ingredient
    input_quantity = Decimal(input_quantity)
    try:
        qty = convert(input_quantity, input_unit, ingredient.unit)
    except IncompatibleUnits as exc:
        raise StockError(str(exc), code="incompatible_units") from exc

    delta = qty * sign
    before = item.stock
    after = before + delta

    if allow_negative is None:
        allow_negative = settings.ESTOQUE_PERMITIR_SALDO_NEGATIVO
    if delta < 0 and after < 0 and not allow_negative:
        raise StockError(
            f"Saldo insuficiente de {ingredient.name}: disponível "
            f"{_fmt(before)} {ingredient.unit}, solicitado {_fmt(qty)} {ingredient.unit}.",
            code="insufficient_stock",
            extra={"ingredient": ingredient.id, "available": before, "unit": ingredient.unit},
        )

    item.stock = after
    item.save(update_fields=["stock", "updated_at"])
    return Movement.objects.create(
        establishment=establishment, ingredient=ingredient, kind=kind, quantity=delta,
        input_quantity=input_quantity, input_unit=input_unit,
        balance_before=before, balance_after=after, total_cost=total_cost, entry=entry,
        reversal_of=reversal_of, notes=notes, user=user,
    )


@dataclass
class EntryItem:
    ingredient_id: int
    quantity: Decimal
    unit: str
    total_cost: Decimal | None = None


def register_entry(*, establishment, user, supplier, invoice_date, items: list[EntryItem],
                   invoice_number="", notes="") -> StockEntry:
    if not items:
        raise StockError("Informe ao menos um item na entrada.")
    with transaction.atomic():
        entry = StockEntry.objects.create(
            establishment=establishment, supplier=supplier, invoice_number=invoice_number,
            invoice_date=invoice_date, notes=notes, created_by=user,
        )
        # Ordena por id para bloquear linhas sempre na mesma ordem (evita deadlock).
        for item in sorted(items, key=lambda i: i.ingredient_id):
            _apply(
                establishment=establishment, ingredient_id=item.ingredient_id,
                kind=Movement.Kind.ENTRADA, input_quantity=item.quantity, input_unit=item.unit,
                user=user, sign=1, entry=entry, total_cost=item.total_cost,
            )
    return entry


def register_exit(*, establishment, user, ingredient_id, quantity, unit,
                  kind=Movement.Kind.CONSUMO, notes="") -> Movement:
    if kind not in (Movement.Kind.CONSUMO, Movement.Kind.PERDA):
        raise StockError("Tipo de saída inválido.")
    if kind == Movement.Kind.PERDA and not notes.strip():
        raise StockError("Informe o motivo da perda.", code="reason_required")
    with transaction.atomic():
        return _apply(
            establishment=establishment, ingredient_id=ingredient_id, kind=kind,
            input_quantity=quantity, input_unit=unit, user=user, sign=-1, notes=notes,
        )


def register_initial(*, establishment, user, ingredient_id, quantity, unit) -> Movement:
    """Saldo inicial informado no cadastro do ingrediente."""
    with transaction.atomic():
        return _apply(
            establishment=establishment, ingredient_id=ingredient_id, kind=Movement.Kind.INICIAL,
            input_quantity=quantity, input_unit=unit, user=user, sign=1,
            notes="Saldo informado no cadastro",
        )


def register_adjustment(*, establishment, user, ingredient_id, counted_quantity, unit, notes) -> Movement:
    """Ajuste manual: informa a quantidade real e o sistema lança a diferença,
    preservando o histórico."""
    if not notes.strip():
        raise StockError("Informe o motivo do ajuste.", code="reason_required")
    with transaction.atomic():
        item = _lock_stock_item(establishment, ingredient_id)
        try:
            counted = convert(Decimal(counted_quantity), unit, item.ingredient.unit)
        except IncompatibleUnits as exc:
            raise StockError(str(exc), code="incompatible_units") from exc
        if counted < 0:
            raise StockError("A quantidade não pode ser negativa.")
        diff = counted - item.stock
        if diff == 0:
            raise StockError("O saldo informado é igual ao saldo atual; nada a ajustar.", code="no_change")
        return _apply(
            establishment=establishment, ingredient_id=ingredient_id, kind=Movement.Kind.AJUSTE,
            input_quantity=abs(diff), input_unit=item.ingredient.unit, user=user,
            sign=1 if diff > 0 else -1, notes=notes, allow_negative=True,
        )


def can_reverse(movement: Movement, user) -> tuple[bool, str]:
    if movement.kind == Movement.Kind.ESTORNO:
        return False, "Um estorno não pode ser estornado."
    if movement.is_reversed:
        return False, "Esta movimentação já foi estornada."
    if user.can("estorno"):
        return True, ""
    if movement.user_id != user.id:
        return False, "Você só pode desfazer os seus próprios lançamentos."
    if movement.kind not in (Movement.Kind.CONSUMO, Movement.Kind.PERDA):
        return False, "Você não tem permissão para estornar este lançamento."
    if timezone.now() - movement.created_at > KITCHEN_UNDO_WINDOW:
        minutes = int(KITCHEN_UNDO_WINDOW.total_seconds() // 60)
        return False, f"O prazo de {minutes} minutos para desfazer expirou. Procure o responsável."
    return True, ""


def reverse_movement(*, movement_id, user, notes="") -> Movement:
    """Correção controlada: gera uma movimentação oposta vinculada à original."""
    with transaction.atomic():
        movement = (Movement.objects.select_for_update()
                    .select_related("ingredient", "establishment").get(pk=movement_id))
        ok, reason = can_reverse(movement, user)
        if not ok:
            raise StockError(reason, code="not_reversible")
        return _apply(
            establishment=movement.establishment, ingredient_id=movement.ingredient_id,
            kind=Movement.Kind.ESTORNO, input_quantity=abs(movement.quantity),
            input_unit=movement.ingredient.unit, user=user,
            sign=-1 if movement.quantity > 0 else 1, entry=movement.entry, reversal_of=movement,
            notes=notes or f"Estorno de {movement.get_kind_display().lower()}",
        )


def cancel_entry(*, entry_id, user, notes="") -> list[Movement]:
    """Estorna todos os itens ainda ativos de uma nota."""
    with transaction.atomic():
        entry = StockEntry.objects.select_for_update().get(pk=entry_id)
        pending = (entry.movements.filter(kind=Movement.Kind.ENTRADA, reversed_by__isnull=True)
                   .order_by("ingredient_id"))
        if not pending.exists():
            raise StockError("Todos os itens desta nota já foram estornados.", code="not_reversible")
        return [reverse_movement(movement_id=m.id, user=user,
                                 notes=notes or f"Cancelamento da entrada #{entry.id}")
                for m in pending]


def create_ingredient(*, establishment, user, name, category, unit, min_stock=Decimal("0"),
                      initial_quantity=None, initial_unit=None) -> Ingredient:
    with transaction.atomic():
        ingredient = Ingredient.objects.create(name=name, category=category, unit=unit)
        StockItem.objects.create(establishment=establishment, ingredient=ingredient, min_stock=min_stock)
        if initial_quantity:
            register_initial(establishment=establishment, user=user, ingredient_id=ingredient.id,
                             quantity=initial_quantity, unit=initial_unit or unit)
    return ingredient
