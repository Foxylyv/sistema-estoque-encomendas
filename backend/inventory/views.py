from datetime import timedelta
from decimal import Decimal

import django_filters
from django.db.models import Count, DecimalField, F, OuterRef, Prefetch, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from accounts.models import CAPABILITIES, PROFILES
from accounts.permissions import Can, get_establishment

from . import export, services
from .models import Category, Ingredient, Movement, StockEntry, StockItem
from .serializers import (
    AdjustmentInputSerializer, CategorySerializer, ExitInputSerializer, IngredientSerializer,
    MovementSerializer, ReverseInputSerializer, StockEntrySerializer,
)
from .units import Unit

EXPORT_LIMIT = 10_000


def stock_error_response(exc: services.StockError):
    return Response({"detail": exc.message, "code": exc.code, **exc.extra},
                    status=status.HTTP_400_BAD_REQUEST)


class EstablishmentMixin:
    @property
    def establishment(self):
        return get_establishment(self.request)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request.user.is_authenticated:
            ctx["establishment"] = self.establishment
        return ctx


class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = [Can("ingredientes", read_only_open=True)]
    pagination_class = None

    def get_queryset(self):
        return Category.objects.annotate(
            ingredient_count=Count("ingredients", filter=Q(ingredients__active=True))
        )

    def destroy(self, request, *args, **kwargs):
        if self.get_object().ingredients.exists():
            return Response(
                {"detail": "Esta categoria possui ingredientes. Mova-os antes de excluir."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)


def annotate_stock(qs, establishment):
    items = StockItem.objects.filter(establishment=establishment, ingredient=OuterRef("pk"))
    dec = DecimalField(max_digits=14, decimal_places=3)
    zero = Value(Decimal("0"), output_field=dec)
    return qs.annotate(
        stock=Coalesce(Subquery(items.values("stock")[:1], output_field=dec), zero),
        min_stock=Coalesce(Subquery(items.values("min_stock")[:1], output_field=dec), zero),
    )


class IngredientFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(
        choices=[("baixo", "baixo"), ("zerado", "zerado"), ("normal", "normal"), ("alerta", "alerta")],
        method="filter_status",
    )

    class Meta:
        model = Ingredient
        fields = ["category", "active", "unit"]

    def filter_status(self, qs, name, value):
        if value == "zerado":
            return qs.filter(stock__lte=0)
        if value == "baixo":
            return qs.filter(stock__gt=0, min_stock__gte=F("stock"))
        if value == "alerta":  # baixo + zerado
            return qs.filter(Q(stock__lte=0) | Q(stock__lte=F("min_stock")))
        return qs.filter(stock__gt=F("min_stock")).filter(stock__gt=0)


class IngredientViewSet(EstablishmentMixin, viewsets.ModelViewSet):
    serializer_class = IngredientSerializer
    permission_classes = [Can("ingredientes", read_only_open=True)]
    filterset_class = IngredientFilter
    search_fields = ["name", "category__name"]
    ordering_fields = ["name", "stock", "min_stock", "updated_at", "category__name", "unit"]
    ordering = ["name"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = annotate_stock(Ingredient.objects.select_related("category"), self.establishment)
        # Por padrão lista só ativos; ?active= permite consultar inativos.
        if "active" not in self.request.query_params:
            qs = qs.filter(active=True)
        return qs

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            ingredient = s.save()
        except services.StockError as exc:
            return stock_error_response(exc)
        fresh = annotate_stock(Ingredient.objects.select_related("category"), self.establishment)
        return Response(self.get_serializer(fresh.get(pk=ingredient.pk)).data,
                        status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        super().update(request, *args, **kwargs)
        return Response(self.get_serializer(self.get_queryset().get(pk=kwargs["pk"])).data)

    @action(detail=True, methods=["get"])
    def movements(self, request, pk=None):
        ingredient = self.get_object()
        qs = _movement_qs().filter(ingredient=ingredient, establishment=self.establishment)
        if not request.user.can("historico"):
            qs = qs.filter(user=request.user)
        return Response(MovementSerializer(qs[:30], many=True, context={"request": request}).data)

    @action(detail=False, methods=["get"], permission_classes=[Can("exportar")])
    def export(self, request):
        qs = self.filter_queryset(self.get_queryset())
        return export.ingredients_xlsx(qs, self.establishment)


def _movement_qs():
    return Movement.objects.select_related("ingredient", "user", "entry", "reversed_by")


class MovementFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    kind = django_filters.MultipleChoiceFilter(choices=Movement.Kind.choices)

    class Meta:
        model = Movement
        fields = ["ingredient", "user", "entry", "kind", "ingredient__category"]


class MovementViewSet(EstablishmentMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                      viewsets.GenericViewSet):
    """Histórico (somente leitura). Saídas, ajustes e estornos têm ações próprias."""

    serializer_class = MovementSerializer
    filterset_class = MovementFilter
    search_fields = ["ingredient__name", "notes", "entry__supplier", "entry__invoice_number"]
    ordering_fields = ["created_at", "quantity", "ingredient__name", "kind", "user__first_name"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        qs = _movement_qs().filter(establishment=self.establishment)
        # Sem a permissão "historico", o usuário vê apenas os próprios lançamentos.
        if not self.request.user.can("historico"):
            qs = qs.filter(user=self.request.user)
        return qs

    def _created(self, mov):
        return Response(self.get_serializer(_movement_qs().get(pk=mov.pk)).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], permission_classes=[Can("baixa")])
    def saida(self, request):
        s = ExitInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        try:
            mov = services.register_exit(
                establishment=self.establishment, user=request.user, ingredient_id=d["ingredient"].id,
                quantity=d["quantity"], unit=d["unit"], kind=d["kind"], notes=d["notes"],
            )
        except services.StockError as exc:
            return stock_error_response(exc)
        return self._created(mov)

    @action(detail=False, methods=["post"], permission_classes=[Can("ajuste")])
    def ajuste(self, request):
        s = AdjustmentInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        try:
            mov = services.register_adjustment(
                establishment=self.establishment, user=request.user, ingredient_id=d["ingredient"].id,
                counted_quantity=d["counted_quantity"], unit=d["unit"], notes=d["notes"],
            )
        except services.StockError as exc:
            return stock_error_response(exc)
        return self._created(mov)

    @action(detail=True, methods=["post"])
    def estornar(self, request, pk=None):
        movement = self.get_object()
        s = ReverseInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            mov = services.reverse_movement(
                movement_id=movement.id, user=request.user, notes=s.validated_data["notes"]
            )
        except services.StockError as exc:
            return stock_error_response(exc)
        return self._created(mov)

    @action(detail=False, methods=["get"], permission_classes=[Can("exportar")])
    def export(self, request):
        qs = self.filter_queryset(self.get_queryset())
        rows = list(qs[: EXPORT_LIMIT + 1])
        return export.movements_xlsx(rows[:EXPORT_LIMIT], self.establishment,
                                     limited=len(rows) > EXPORT_LIMIT)


class StockEntryViewSet(EstablishmentMixin, mixins.CreateModelMixin, mixins.ListModelMixin,
                        mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = StockEntrySerializer
    permission_classes = [Can("entrada")]
    search_fields = ["supplier", "invoice_number"]
    filterset_fields = {"invoice_date": ["gte", "lte"], "supplier": ["exact"]}

    def get_queryset(self):
        return (StockEntry.objects.filter(establishment=self.establishment)
                .select_related("created_by")
                .prefetch_related(Prefetch("movements", queryset=_movement_qs().order_by("id"))))

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        try:
            entry = services.register_entry(
                establishment=self.establishment, user=request.user, supplier=d["supplier"],
                invoice_date=d["invoice_date"], invoice_number=d.get("invoice_number", ""),
                notes=d.get("notes", ""),
                items=[services.EntryItem(ingredient_id=i["ingredient"].id, quantity=i["quantity"],
                                          unit=i["unit"], total_cost=i.get("total_cost"))
                       for i in d["items"]],
            )
        except services.StockError as exc:
            return stock_error_response(exc)
        return Response(self.get_serializer(self.get_queryset().get(pk=entry.pk)).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], permission_classes=[Can("estorno")])
    def cancelar(self, request, pk=None):
        entry = self.get_object()
        s = ReverseInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            services.cancel_entry(entry_id=entry.id, user=request.user, notes=s.validated_data["notes"])
        except services.StockError as exc:
            return stock_error_response(exc)
        return Response(self.get_serializer(self.get_queryset().get(pk=entry.pk)).data)

    @action(detail=False, methods=["get"])
    def fornecedores(self, request):
        names = StockEntry.objects.values_list("supplier", flat=True).distinct().order_by("supplier")
        return Response(list(names))


@api_view(["GET"])
def dashboard(request):
    est = get_establishment(request)
    now = timezone.localtime()
    active = annotate_stock(Ingredient.objects.filter(active=True), est)
    alerts = (active.filter(Q(stock__lte=0) | Q(stock__lte=F("min_stock")))
              .select_related("category").order_by("stock", "name"))

    moves = Movement.objects.filter(establishment=est)
    recent = _movement_qs().filter(establishment=est)
    if not request.user.can("historico"):
        recent = recent.filter(user=request.user)

    today_moves = moves.filter(created_at__date=now.date())
    top_consumed = (
        moves.filter(kind=Movement.Kind.CONSUMO, created_at__gte=now - timedelta(days=7),
                     reversed_by__isnull=True)
        .values("ingredient", "ingredient__name", "ingredient__unit")
        .annotate(total=Sum("quantity"), count=Count("id")).order_by("-count", "total")[:5]
    )

    return Response({
        "totals": {
            "ingredients": active.count(),
            "low": active.filter(stock__gt=0, min_stock__gte=F("stock")).count(),
            "zero": active.filter(stock__lte=0).count(),
            "entries_today": today_moves.filter(kind=Movement.Kind.ENTRADA).count(),
            "exits_today": today_moves.filter(
                kind__in=[Movement.Kind.CONSUMO, Movement.Kind.PERDA]).count(),
        },
        "alerts": IngredientSerializer(alerts[:20], many=True).data,
        "recent": MovementSerializer(recent[:8], many=True, context={"request": request}).data,
        "top_consumed": [
            {"ingredient": r["ingredient"], "name": r["ingredient__name"],
             "unit": r["ingredient__unit"], "total": abs(r["total"]), "count": r["count"]}
            for r in top_consumed
        ],
    })


@api_view(["GET"])
def meta(request):
    return Response({
        "units": [{"value": v, "label": l} for v, l in Unit.choices],
        "movement_kinds": [{"value": v, "label": l} for v, l in Movement.Kind.choices],
        "capabilities": [{"code": c, "label": l, "help": h} for c, l, h in CAPABILITIES],
        "profiles": PROFILES,
        "allow_negative_stock": services.settings.ESTOQUE_PERMITIR_SALDO_NEGATIVO,
        "kitchen_undo_minutes": int(services.KITCHEN_UNDO_WINDOW.total_seconds() // 60),
    })


@api_view(["GET"])
def network_dashboard(request):
    """Visão consolidada de todas as unidades ativas (somente admin master)."""
    if not request.user.is_master_user:
        raise PermissionDenied("Apenas o admin master vê o painel da rede.")
    from accounts.models import Establishment
    from .models import stock_status

    now = timezone.localtime()
    units = list(Establishment.objects.filter(active=True).order_by("name"))
    unit_ids = [u.id for u in units]
    ingredients = list(Ingredient.objects.filter(active=True).select_related("category").order_by("name"))

    items = {(s.establishment_id, s.ingredient_id): s
             for s in StockItem.objects.filter(establishment_id__in=unit_ids, ingredient__active=True)}
    moves = Movement.objects.filter(establishment_id__in=unit_ids)
    today = moves.filter(created_at__date=now.date())
    month = moves.filter(created_at__gte=now - timedelta(days=30))
    week_consumo = moves.filter(kind=Movement.Kind.CONSUMO, created_at__gte=now - timedelta(days=7),
                                reversed_by__isnull=True)

    def per_unit(qs, field="id", agg=None):
        rows = qs.values("establishment_id").annotate(v=agg or Count(field))
        return {r["establishment_id"]: r["v"] for r in rows}

    entries_today = per_unit(today.filter(kind=Movement.Kind.ENTRADA))
    exits_today = per_unit(today.filter(kind__in=[Movement.Kind.CONSUMO, Movement.Kind.PERDA]))
    purchases = per_unit(month.filter(kind=Movement.Kind.ENTRADA, reversed_by__isnull=True),
                         agg=Sum("total_cost"))
    losses = per_unit(month.filter(kind=Movement.Kind.PERDA, reversed_by__isnull=True))
    last = {uid: moves.filter(establishment_id=uid).select_related("user").order_by("-created_at").first()
            for uid in unit_ids}

    matrix, low_by_unit, zero_by_unit = [], {u: 0 for u in unit_ids}, {u: 0 for u in unit_ids}
    for ing in ingredients:
        per, total = {}, Decimal("0")
        for uid in unit_ids:
            it = items.get((uid, ing.id))
            stock = it.stock if it else Decimal("0")
            minimum = it.min_stock if it else Decimal("0")
            st = stock_status(stock, minimum)
            low_by_unit[uid] += st == "baixo"
            zero_by_unit[uid] += st == "zerado"
            per[uid] = {"stock": stock, "min": minimum, "status": st}
            total += stock
        matrix.append({"id": ing.id, "name": ing.name, "unit": ing.unit,
                       "category": ing.category.name, "total": total, "per": per})

    top = (week_consumo.values("ingredient", "ingredient__name", "ingredient__unit", "establishment_id")
           .annotate(total=Sum("quantity"), count=Count("id")))
    top_map = {}
    for r in top:
        t = top_map.setdefault(r["ingredient"], {"ingredient": r["ingredient"], "name": r["ingredient__name"],
                                                 "unit": r["ingredient__unit"], "total": Decimal("0"),
                                                 "count": 0, "per": {}})
        t["total"] += abs(r["total"])
        t["count"] += r["count"]
        t["per"][r["establishment_id"]] = abs(r["total"])
    # Ordena pelo nº de baixas: quantidades em g, L e un não são comparáveis entre si.
    top_consumed = sorted(top_map.values(), key=lambda t: (-t["count"], t["name"]))[:8]

    unit_rows = []
    for u in units:
        lm = last.get(u.id)
        unit_rows.append({
            "id": u.id, "name": u.name,
            "low": low_by_unit[u.id], "zero": zero_by_unit[u.id],
            "entries_today": entries_today.get(u.id, 0), "exits_today": exits_today.get(u.id, 0),
            "purchases_30d": purchases.get(u.id) or Decimal("0"),
            "losses_30d": losses.get(u.id, 0),
            "last_movement_at": lm.created_at if lm else None,
            "last_movement_by": (lm.user.get_full_name() or lm.user.username) if lm else None,
        })

    return Response({
        "totals": {
            "units": len(units),
            "ingredients": len(ingredients),
            "low": sum(low_by_unit.values()),
            "zero": sum(zero_by_unit.values()),
            "entries_today": sum(entries_today.values()),
            "exits_today": sum(exits_today.values()),
            "purchases_30d": sum((r["purchases_30d"] for r in unit_rows), Decimal("0")),
        },
        "units": unit_rows,
        "matrix": matrix,
        "top_consumed": top_consumed,
    })
