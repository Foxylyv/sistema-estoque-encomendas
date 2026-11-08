from django.contrib import admin

from .models import Order, OrderEvent, OrderItem, Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "group", "active"]
    list_filter = ["active", "group"]
    search_fields = ["name"]


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ["product", "product_name", "quantity", "notes"]
    can_delete = False


class OrderEventInline(admin.TabularInline):
    model = OrderEvent
    extra = 0
    readonly_fields = ["action", "status", "note", "user", "created_at"]
    can_delete = False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["id", "customer_name", "store", "due_at", "status", "created_at"]
    list_filter = ["status", "store"]
    search_fields = ["customer_name", "customer_phone"]
    inlines = [OrderItemInline, OrderEventInline]
    readonly_fields = ["status_changed_at", "printed_at", "created_by", "created_at"]
