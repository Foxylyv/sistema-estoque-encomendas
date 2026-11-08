from django.contrib import admin

from .models import Category, Ingredient, Movement, StockEntry, StockItem


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "order"]


@admin.register(Ingredient)
class IngredientAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "unit", "active"]
    list_filter = ["category", "active"]
    search_fields = ["name"]


@admin.register(StockItem)
class StockItemAdmin(admin.ModelAdmin):
    list_display = ["ingredient", "establishment", "stock", "min_stock"]
    list_filter = ["establishment"]
    readonly_fields = ["stock"]


@admin.register(StockEntry)
class StockEntryAdmin(admin.ModelAdmin):
    list_display = ["id", "establishment", "supplier", "invoice_number", "invoice_date", "created_by", "created_at"]


@admin.register(Movement)
class MovementAdmin(admin.ModelAdmin):
    """Somente leitura: o histórico não pode ser editado pelo admin do Django."""

    list_display = ["created_at", "establishment", "kind", "ingredient", "quantity", "balance_after", "user"]
    list_filter = ["establishment", "kind", "ingredient__category"]
    search_fields = ["ingredient__name"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
