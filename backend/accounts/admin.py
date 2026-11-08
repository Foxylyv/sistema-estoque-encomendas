from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Establishment, User


@admin.register(Establishment)
class EstablishmentAdmin(admin.ModelAdmin):
    list_display = ["name", "address", "active"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["username", "first_name", "last_name", "establishment", "is_master", "is_active"]
    list_filter = ["establishment", "is_master", "is_active"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Acesso", {"fields": ("is_master", "establishment", "capabilities")}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ("Acesso", {"fields": ("is_master", "establishment", "capabilities")}),
    )
