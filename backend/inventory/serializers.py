from decimal import Decimal

from rest_framework import serializers

from . import services
from .models import Category, Ingredient, Movement, StockEntry, StockItem, stock_status
from .units import Unit, compatible_units

POSITIVE = dict(max_digits=14, decimal_places=3, min_value=Decimal("0.001"))
NON_NEGATIVE = dict(max_digits=14, decimal_places=3, min_value=Decimal("0"))


class CategorySerializer(serializers.ModelSerializer):
    ingredient_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Category
        fields = ["id", "name", "order", "ingredient_count"]


class IngredientSerializer(serializers.ModelSerializer):
    """Ingrediente do catálogo + saldo/mínimo da unidade em uso (anotados na view)."""

    category_name = serializers.CharField(source="category.name", read_only=True)
    stock = serializers.DecimalField(max_digits=14, decimal_places=3, read_only=True)
    min_stock = serializers.DecimalField(required=False, **NON_NEGATIVE)
    status = serializers.SerializerMethodField()
    compatible_units = serializers.SerializerMethodField()
    initial_quantity = serializers.DecimalField(write_only=True, required=False, allow_null=True, **NON_NEGATIVE)
    initial_unit = serializers.ChoiceField(choices=Unit.choices, write_only=True, required=False)

    class Meta:
        model = Ingredient
        fields = [
            "id", "name", "category", "category_name", "unit", "min_stock", "stock",
            "status", "active", "compatible_units", "updated_at", "initial_quantity", "initial_unit",
        ]
        read_only_fields = ["updated_at"]

    def get_status(self, obj):
        return stock_status(getattr(obj, "stock", 0), getattr(obj, "min_stock", 0))

    def get_compatible_units(self, obj):
        return compatible_units(obj.unit)

    def validate_unit(self, value):
        inst = self.instance
        if inst and inst.unit != value and inst.movements.exists():
            raise serializers.ValidationError(
                "Não é possível alterar a unidade de um ingrediente que já possui movimentações."
            )
        return value

    def validate(self, attrs):
        unit = attrs.get("unit", getattr(self.instance, "unit", None))
        iu = attrs.get("initial_unit")
        if iu and unit and iu not in compatible_units(unit):
            raise serializers.ValidationError({"initial_unit": f"Unidade {iu} incompatível com {unit}."})
        return attrs

    def create(self, data):
        return services.create_ingredient(
            establishment=self.context["establishment"], user=self.context["request"].user,
            name=data["name"], category=data["category"], unit=data["unit"],
            min_stock=data.get("min_stock") or Decimal("0"),
            initial_quantity=data.get("initial_quantity"), initial_unit=data.get("initial_unit"),
        )

    def update(self, instance, data):
        data.pop("initial_quantity", None)
        data.pop("initial_unit", None)
        min_stock = data.pop("min_stock", None)
        for k, v in data.items():
            setattr(instance, k, v)
        instance.save()
        if min_stock is not None:
            StockItem.objects.update_or_create(
                establishment=self.context["establishment"], ingredient=instance,
                defaults={"min_stock": min_stock},
            )
        return instance


class MovementSerializer(serializers.ModelSerializer):
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    ingredient_unit = serializers.CharField(source="ingredient.unit", read_only=True)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    user_name = serializers.SerializerMethodField()
    is_reversed = serializers.BooleanField(read_only=True)
    can_reverse = serializers.SerializerMethodField()
    entry_label = serializers.SerializerMethodField()

    class Meta:
        model = Movement
        fields = [
            "id", "ingredient", "ingredient_name", "ingredient_unit", "kind", "kind_display",
            "quantity", "input_quantity", "input_unit", "balance_before", "balance_after",
            "total_cost", "entry", "entry_label", "reversal_of", "is_reversed", "can_reverse",
            "notes", "user", "user_name", "created_at",
        ]

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_entry_label(self, obj):
        return str(obj.entry) if obj.entry_id else None

    def get_can_reverse(self, obj):
        request = self.context.get("request")
        return bool(request and services.can_reverse(obj, request.user)[0])


class ExitInputSerializer(serializers.Serializer):
    ingredient = serializers.PrimaryKeyRelatedField(queryset=Ingredient.objects.filter(active=True))
    quantity = serializers.DecimalField(**POSITIVE)
    unit = serializers.ChoiceField(choices=Unit.choices)
    kind = serializers.ChoiceField(
        choices=[Movement.Kind.CONSUMO, Movement.Kind.PERDA], default=Movement.Kind.CONSUMO
    )
    notes = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class AdjustmentInputSerializer(serializers.Serializer):
    ingredient = serializers.PrimaryKeyRelatedField(queryset=Ingredient.objects.all())
    counted_quantity = serializers.DecimalField(**NON_NEGATIVE)
    unit = serializers.ChoiceField(choices=Unit.choices)
    notes = serializers.CharField(max_length=255)


class ReverseInputSerializer(serializers.Serializer):
    notes = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class EntryItemInputSerializer(serializers.Serializer):
    ingredient = serializers.PrimaryKeyRelatedField(queryset=Ingredient.objects.filter(active=True))
    quantity = serializers.DecimalField(**POSITIVE)
    unit = serializers.ChoiceField(choices=Unit.choices)
    total_cost = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True
    )


class StockEntrySerializer(serializers.ModelSerializer):
    items = EntryItemInputSerializer(many=True, write_only=True)
    movements = MovementSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    total_cost = serializers.SerializerMethodField()
    is_cancelled = serializers.SerializerMethodField()

    class Meta:
        model = StockEntry
        fields = [
            "id", "supplier", "invoice_number", "invoice_date", "notes", "items",
            "movements", "created_by", "created_by_name", "created_at", "total_cost",
            "is_cancelled",
        ]
        read_only_fields = ["created_by", "created_at"]

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username

    def _entradas(self, obj):
        return [m for m in obj.movements.all() if m.kind == Movement.Kind.ENTRADA]

    def get_total_cost(self, obj):
        return sum((m.total_cost for m in self._entradas(obj) if m.total_cost is not None), Decimal("0"))

    def get_is_cancelled(self, obj):
        entradas = self._entradas(obj)
        return bool(entradas) and all(m.is_reversed for m in entradas)

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("Informe ao menos um item.")
        for item in items:
            ing = item["ingredient"]
            if item["unit"] not in compatible_units(ing.unit):
                raise serializers.ValidationError(
                    f"{ing.name}: unidade {item['unit']} incompatível com {ing.unit}."
                )
        return items
