from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import Establishment

HEADER = "HTTP_X_ESTABLISHMENT"


class IsMaster(BasePermission):
    message = "Apenas o admin master pode realizar esta ação."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_master_user)


def Can(code, *, read_only_open=False):
    """Fábrica de permissão: exige a permissão `code`.
    Com read_only_open=True, leitura fica liberada para qualquer usuário autenticado."""

    class _Can(BasePermission):
        message = "Você não tem permissão para esta ação. Fale com o administrador."

        def has_permission(self, request, view):
            user = request.user
            if not (user and user.is_authenticated):
                return False
            if read_only_open and request.method in SAFE_METHODS:
                return True
            return user.can(code)

    _Can.__name__ = f"Can_{code}"
    return _Can


def get_establishment(request) -> Establishment:
    """Unidade em uso na requisição.

    Funcionário: sempre a unidade dele. Admin master: a do cabeçalho
    X-Establishment, ou a primeira unidade ativa se não for informada.
    """
    cached = getattr(request, "_establishment", None)
    if cached:
        return cached
    user = request.user
    if user.is_master_user:
        est_id = request.META.get(HEADER)
        qs = Establishment.objects.all()
        if est_id:
            try:
                est = qs.get(pk=int(est_id))
            except (ValueError, Establishment.DoesNotExist):
                raise ValidationError({"detail": "Unidade selecionada não existe."})
        else:
            est = qs.filter(active=True).first()
            if est is None:
                raise ValidationError({"detail": "Cadastre uma unidade antes de continuar.",
                                       "code": "no_establishment"})
    else:
        est = user.establishment
        if est is None or not est.active:
            raise PermissionDenied("Seu usuário não está vinculado a uma unidade ativa.")
    request._establishment = est
    return est
