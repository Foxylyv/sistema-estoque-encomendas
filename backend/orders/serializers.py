from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .models import Order, OrderEvent, OrderItem, Product

# Tolerância para a hora de entrega: evita recusar uma encomenda "para agora".
PAST_TOLERANCE = timedelta(minutes=10)
MAX_ITEMS = 50
MAX_QTY = 999


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = ["id", "name", "group", "description", "active"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Informe o nome do produto.")
        return value

    def validate_group(self, value):
        return value.strip()


class OrderItemSerializer(serializers.ModelSerializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField(min_value=1, max_value=MAX_QTY)

    class Meta:
        model = OrderItem
        fields = ["id", "product", "product_name", "quantity", "notes"]
        read_only_fields = ["product_name"]

    def validate_product(self, product):
        if not product.active:
            raise serializers.ValidationError(f"O produto “{product.name}” está inativo.")
        return product


class OrderEventSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = OrderEvent
        fields = ["id", "action", "status", "status_label", "note", "user_name", "created_at"]

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True)
    store_name = serializers.CharField(source="store.name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id", "store", "store_name", "customer_name", "customer_phone", "due_at", "notes",
            "status", "status_label", "status_changed_at", "printed_at", "cancel_reason",
            "created_by", "created_by_name", "created_at", "items",
        ]
        read_only_fields = [
            "store", "status", "status_changed_at", "printed_at", "cancel_reason",
            "created_by", "created_at",
        ]

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username

    def validate_customer_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Informe o nome do cliente.")
        return value

    def validate_due_at(self, value):
        if value < timezone.now() - PAST_TOLERANCE:
            raise serializers.ValidationError("A data de entrega já passou. Confira o dia e a hora.")
        return value

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("Adicione ao menos um produto.")
        if len(items) > MAX_ITEMS:
            raise serializers.ValidationError(f"No máximo {MAX_ITEMS} itens por encomenda.")
        return items


class OrderDetailSerializer(OrderSerializer):
    events = OrderEventSerializer(many=True, read_only=True)

    class Meta(OrderSerializer.Meta):
        fields = [*OrderSerializer.Meta.fields, "events"]


class StatusInputSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        s for s in Order.Status.choices if s[0] != Order.Status.CANCELADO
    ])


class CancelInputSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255, trim_whitespace=True)
