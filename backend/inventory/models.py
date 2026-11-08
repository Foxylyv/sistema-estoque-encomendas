from decimal import Decimal

from django.conf import settings
from django.db import models

from accounts.models import Establishment

from .units import Unit

QTY = dict(max_digits=14, decimal_places=3)


def stock_status(stock, min_stock) -> str:
    stock, min_stock = Decimal(stock or 0), Decimal(min_stock or 0)
    if stock <= 0:
        return "zerado"
    if stock <= min_stock:
        return "baixo"
    return "normal"


class Category(models.Model):
    name = models.CharField("nome", max_length=80, unique=True)
    order = models.PositiveIntegerField("ordem", default=0)

    class Meta:
        ordering = ["order", "name"]
        verbose_name = "categoria"

    def __str__(self):
        return self.name


class Ingredient(models.Model):
    """Item do catálogo, compartilhado por todas as unidades."""

    name = models.CharField("nome", max_length=120, unique=True)
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="ingredients", verbose_name="categoria"
    )
    unit = models.CharField("unidade padrão", max_length=4, choices=Unit.choices)
    active = models.BooleanField("ativo", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "ingrediente"

    def __str__(self):
        return self.name


class StockItem(models.Model):
    """Saldo e estoque mínimo de um ingrediente em uma unidade.

    O saldo nunca é editado diretamente: só muda por meio de movimentações
    (ver services.py), garantindo que o histórico explique o saldo.
    """

    establishment = models.ForeignKey(Establishment, on_delete=models.CASCADE, related_name="stock_items")
    ingredient = models.ForeignKey(Ingredient, on_delete=models.CASCADE, related_name="stock_items")
    stock = models.DecimalField("saldo", default=Decimal("0"), editable=False, **QTY)
    min_stock = models.DecimalField("estoque mínimo", default=Decimal("0"), **QTY)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "saldo"
        constraints = [
            models.UniqueConstraint(fields=["establishment", "ingredient"], name="uniq_stock_item")
        ]

    @property
    def status(self):
        return stock_status(self.stock, self.min_stock)


class StockEntry(models.Model):
    """Entrada de mercadorias vinculada a uma nota fiscal conferida."""

    establishment = models.ForeignKey(Establishment, on_delete=models.PROTECT, related_name="entries")
    supplier = models.CharField("fornecedor", max_length=150)
    invoice_number = models.CharField("número da nota", max_length=60, blank=True)
    invoice_date = models.DateField("data da nota")
    notes = models.TextField("observações", blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="entries"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "entrada de mercadoria"
        verbose_name_plural = "entradas de mercadorias"

    def __str__(self):
        nf = f"NF {self.invoice_number}" if self.invoice_number else "sem NF"
        return f"{self.supplier} — {nf}"


class Movement(models.Model):
    class Kind(models.TextChoices):
        INICIAL = "inicial", "Saldo inicial"
        ENTRADA = "entrada", "Entrada"
        CONSUMO = "consumo", "Consumo"
        PERDA = "perda", "Perda"
        AJUSTE = "ajuste", "Ajuste manual"
        ESTORNO = "estorno", "Estorno"

    establishment = models.ForeignKey(Establishment, on_delete=models.PROTECT, related_name="movements")
    ingredient = models.ForeignKey(Ingredient, on_delete=models.PROTECT, related_name="movements")
    kind = models.CharField("tipo", max_length=10, choices=Kind.choices)
    # Variação no saldo, na unidade padrão do ingrediente (positiva ou negativa).
    quantity = models.DecimalField("quantidade", **QTY)
    # O que o usuário digitou, antes da conversão (ex.: 500 g para um item em kg).
    input_quantity = models.DecimalField("quantidade informada", **QTY)
    input_unit = models.CharField("unidade informada", max_length=4, choices=Unit.choices)
    balance_before = models.DecimalField("saldo antes", **QTY)
    balance_after = models.DecimalField("saldo após", **QTY)
    total_cost = models.DecimalField("valor total", max_digits=12, decimal_places=2, null=True, blank=True)
    entry = models.ForeignKey(
        StockEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="movements"
    )
    reversal_of = models.OneToOneField(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversed_by"
    )
    notes = models.CharField("observação", max_length=255, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="movements"
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "movimentação"
        verbose_name_plural = "movimentações"

    def __str__(self):
        return f"{self.get_kind_display()} {self.quantity} {self.ingredient.unit} — {self.ingredient}"

    @property
    def is_reversed(self) -> bool:
        return hasattr(self, "reversed_by")
