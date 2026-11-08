from django.db.models import Count
from rest_framework import status, viewsets
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

from .models import Establishment, User
from .permissions import Can, IsMaster
from .serializers import EstablishmentSerializer, UserSerializer


@api_view(["GET"])
def me(request):
    return Response(UserSerializer(request.user).data)


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related("establishment").order_by("first_name", "username")
    serializer_class = UserSerializer
    permission_classes = [Can("usuarios")]
    search_fields = ["username", "first_name", "last_name"]
    filterset_fields = ["establishment", "is_active", "is_master"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_master_user:
            # Gerente: só funcionários da própria unidade (nunca usuários master).
            qs = qs.filter(establishment=user.establishment, is_master=False, is_superuser=False)
        return qs

    def _check_manager_limits(self, serializer):
        user = self.request.user
        if user.is_master_user:
            return
        data = serializer.validated_data
        if data.get("is_master"):
            raise PermissionDenied("Apenas o admin master pode criar outro admin master.")
        est = data.get("establishment")
        if est is not None and est != user.establishment:
            raise PermissionDenied("Você só pode gerenciar funcionários da sua unidade.")
        data["establishment"] = user.establishment

    def perform_create(self, serializer):
        self._check_manager_limits(serializer)
        serializer.save()

    def perform_update(self, serializer):
        self._check_manager_limits(serializer)
        me = self.request.user
        if serializer.instance == me and not me.is_superuser:
            data = serializer.validated_data
            if data.get("is_active") is False or (me.is_master and data.get("is_master") is False):
                raise ValidationError("Você não pode desativar nem rebaixar o próprio usuário.")
            if not me.is_master_user and "usuarios" not in data.get("capabilities", me.capabilities):
                raise ValidationError("Você não pode remover a própria permissão de gerenciar funcionários.")
        serializer.save()


class EstablishmentViewSet(viewsets.ModelViewSet):
    serializer_class = EstablishmentSerializer
    pagination_class = None

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return super().get_permissions()
        return [IsMaster()]

    def get_queryset(self):
        qs = Establishment.objects.annotate(user_count=Count("users"))
        user = self.request.user
        if not user.is_master_user:
            qs = qs.filter(pk=user.establishment_id)
        return qs

    def destroy(self, request, *args, **kwargs):
        est = self.get_object()
        if est.users.exists() or est.movements.exists():
            return Response(
                {"detail": "Esta unidade já tem usuários ou movimentações. Desative-a em vez de excluir."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)
