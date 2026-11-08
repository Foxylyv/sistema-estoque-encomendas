from datetime import datetime, time, timedelta

from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.response import Response

from accounts.permissions import get_establishment

from .models import Order, OrderEvent, OrderItem, Product
from .serializers import (
    CancelInputSerializer, OrderDetailSerializer, OrderSerializer, ProductSerializer,
    StatusInputSerializer,
)

# Encomendas enviadas continuam no quadro por um tempo, para a fábrica conferir.
SENT_VISIBLE_FOR = timedelta(hours=24)
FABRICA, LOJA = "fabrica", "loja"


def order_scope(request):
    """Define o que o usuário enxerga, conforme a unidade em uso.

    - Unidade do tipo fábrica + permissão "producao" (ou admin master): todas as encomendas.
    - Loja + permissão "encomendas" (ou admin master): só as encomendas daquela loja.
    """
    est = get_establishment(request)
    user = request.user
    if est.is_factory:
        if user.can("producao"):
            return FABRICA, est
        raise PermissionDenied("Você não tem acesso ao quadro de encomendas da fábrica.")
    if user.can("encomendas"):
        return LOJA, est
    raise PermissionDenied("Você não tem permissão para registrar encomendas.")


class CanManageProducts(BasePermission):
    message = "Só a fábrica (ou o admin master) cadastra produtos."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        if user.is_master_user:
            return True
        est = user.establishment
        return bool(est and est.active and est.is_factory and user.can("producao"))


class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    permission_classes = [CanManageProducts]
    pagination_class = None
    search_fields = ["name", "group"]
    filterset_fields = ["active"]

    def get_queryset(self):
        return Product.objects.all()

    def destroy(self, request, *args, **kwargs):
        if self.get_object().order_items.exists():
            return Response(
                {"detail": "Este produto já aparece em encomendas. Desative-o em vez de excluir."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def grupos(self, request):
        groups = (Product.objects.exclude(group="").order_by("group")
                  .values_list("group", flat=True).distinct())
        return Response(list(groups))


def _day_start(d):
    return timezone.make_aware(datetime.combine(d, time.min))


class OrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                   viewsets.GenericViewSet):
    """Encomendas. Não há edição: depois de registrada, só muda o andamento ou é cancelada."""

    serializer_class = OrderSerializer
    search_fields = ["customer_name", "customer_phone", "=id"]
    ordering_fields = ["due_at", "created_at", "id"]
    ordering = ["due_at", "id"]

    def get_serializer_class(self):
        return OrderDetailSerializer if self.action == "retrieve" else OrderSerializer

    def get_queryset(self):
        scope, est = order_scope(self.request)
        qs = Order.objects.select_related("store", "created_by").prefetch_related(
            Prefetch("items", queryset=OrderItem.objects.order_by("id"))
        )
        if self.action == "retrieve":
            qs = qs.prefetch_related(Prefetch("events", queryset=OrderEvent.objects.select_related("user")))
        if scope == LOJA:
            qs = qs.filter(store=est)
        if self.action != "list":
            return qs

        p = self.request.query_params
        if p.get("quadro"):
            qs = qs.filter(
                Q(status__in=[Order.Status.AGENDADO, Order.Status.PRODUCAO, Order.Status.PRONTO])
                | Q(status=Order.Status.ENVIADO, status_changed_at__gte=timezone.now() - SENT_VISIBLE_FOR)
            )
        if p.get("status"):
            qs = qs.filter(status__in=p.getlist("status"))
        if p.get("loja") and scope == FABRICA:
            qs = qs.filter(store_id=p["loja"])
        if p.get("ativas"):
            qs = qs.exclude(status__in=[Order.Status.ENVIADO, Order.Status.CANCELADO])
        if d := parse_date(p.get("de") or ""):
            qs = qs.filter(due_at__gte=_day_start(d))
        if d := parse_date(p.get("ate") or ""):
            qs = qs.filter(due_at__lt=_day_start(d + timedelta(days=1)))
        return qs

    def paginate_queryset(self, queryset):
        # O quadro da fábrica e a impressão do dia trazem tudo de uma vez.
        if self.request.query_params.get("quadro") or self.request.query_params.get("todas"):
            return None
        return super().paginate_queryset(queryset)

    def create(self, request, *args, **kwargs):
        scope, est = order_scope(request)
        if scope != LOJA:
            raise PermissionDenied("Encomendas são registradas pelas lojas. Selecione uma loja.")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        items = data.pop("items")
        with transaction.atomic():
            order = Order.objects.create(store=est, created_by=request.user, **data)
            OrderItem.objects.bulk_create([
                OrderItem(order=order, product=it["product"], product_name=it["product"].name,
                          quantity=it["quantity"], notes=(it.get("notes") or "").strip())
                for it in items
            ])
            OrderEvent.objects.create(order=order, action="criada", status=order.status, user=request.user)
        order = self.get_queryset().get(pk=order.pk)
        return Response(OrderSerializer(order, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)

    def _factory_only(self):
        scope, _ = order_scope(self.request)
        if scope != FABRICA:
            raise PermissionDenied("Só a fábrica pode alterar o andamento das encomendas.")

    def _locked(self, pk):
        order = self.get_object()  # garante o escopo e o 404
        return Order.objects.select_for_update().get(pk=order.pk)

    def _respond(self, order):
        order = self.get_queryset().get(pk=order.pk)
        return Response(OrderSerializer(order, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    def andamento(self, request, pk=None):
        self._factory_only()
        new = StatusInputSerializer(data=request.data)
        new.is_valid(raise_exception=True)
        new_status = new.validated_data["status"]
        with transaction.atomic():
            order = self._locked(pk)
            if order.status == Order.Status.CANCELADO:
                raise ValidationError({"detail": "Esta encomenda foi cancelada."})
            if order.status != new_status:
                order.status = new_status
                order.status_changed_at = timezone.now()
                order.save(update_fields=["status", "status_changed_at"])
                OrderEvent.objects.create(order=order, action="andamento", status=new_status, user=request.user)
        return self._respond(order)

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        self._factory_only()
        data = CancelInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        reason = data.validated_data["reason"]
        with transaction.atomic():
            order = self._locked(pk)
            if order.status == Order.Status.CANCELADO:
                raise ValidationError({"detail": "Esta encomenda já foi cancelada."})
            order.status = Order.Status.CANCELADO
            order.status_changed_at = timezone.now()
            order.cancel_reason = reason
            order.save(update_fields=["status", "status_changed_at", "cancel_reason"])
            OrderEvent.objects.create(order=order, action="cancelada", status=order.status,
                                      note=reason, user=request.user)
        return self._respond(order)

    @action(detail=False, methods=["post"])
    def impressas(self, request):
        """Marca encomendas como impressas pela fábrica (some o aviso de "não impressa")."""
        scope, _ = order_scope(request)
        ids = request.data.get("ids") or []
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            raise ValidationError({"ids": "Envie a lista de encomendas."})
        if scope != FABRICA or not ids:
            return Response({"marked": 0})
        now = timezone.now()
        with transaction.atomic():
            pending = list(self.get_queryset().filter(pk__in=ids, printed_at__isnull=True))
            Order.objects.filter(pk__in=[o.pk for o in pending]).update(printed_at=now)
            OrderEvent.objects.bulk_create([
                OrderEvent(order=o, action="impressa", status=o.status, user=request.user) for o in pending
            ])
        return Response({"marked": len(pending)})
