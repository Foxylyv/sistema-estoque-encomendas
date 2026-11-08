from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts.views import EstablishmentViewSet, UserViewSet, me
from orders.views import OrderViewSet, ProductViewSet
from inventory.views import (
    CategoryViewSet, IngredientViewSet, MovementViewSet, StockEntryViewSet, dashboard, meta,
    network_dashboard,
)

router = DefaultRouter()
router.register("users", UserViewSet)
router.register("establishments", EstablishmentViewSet, basename="establishment")
router.register("categories", CategoryViewSet, basename="category")
router.register("ingredients", IngredientViewSet, basename="ingredient")
router.register("movements", MovementViewSet, basename="movement")
router.register("entries", StockEntryViewSet, basename="entry")
router.register("products", ProductViewSet, basename="product")
router.register("orders", OrderViewSet, basename="order")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/token/", TokenObtainPairView.as_view(), name="token_obtain"),
    path("api/auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/me/", me, name="me"),
    path("api/dashboard/", dashboard, name="dashboard"),
    path("api/dashboard/rede/", network_dashboard, name="network_dashboard"),
    path("api/meta/", meta, name="meta"),
    path("api/", include(router.urls)),
]
