from django.contrib.auth.models import AbstractUser
from django.db import models


class Establishment(models.Model):
    """Unidade (cafeteria/doceria ou fábrica). Cada uma tem saldo e estoque mínimo próprios."""

    class Kind(models.TextChoices):
        LOJA = "loja", "Loja"
        FABRICA = "fabrica", "Fábrica"

    name = models.CharField("nome", max_length=120, unique=True)
    address = models.CharField("endereço", max_length=255, blank=True)
    kind = models.CharField(
        "tipo", max_length=10, choices=Kind.choices, default=Kind.LOJA,
        help_text="Lojas registram encomendas; a fábrica recebe todas no quadro de produção.",
    )
    active = models.BooleanField("ativa", default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "unidade"

    def __str__(self):
        return self.name

    @property
    def is_factory(self) -> bool:
        return self.kind == self.Kind.FABRICA


# Permissões que o admin master pode conceder a cada funcionário.
CAPABILITIES = [
    ("baixa", "Registrar consumo e perdas",
     "Dar baixa nos ingredientes usados na produção e registrar perdas."),
    ("entrada", "Registrar entradas de mercadorias",
     "Lançar as compras recebidas com base na nota fiscal."),
    ("ajuste", "Ajustar saldo manualmente",
     "Corrigir o saldo pelo inventário físico. Fica registrado no histórico."),
    ("estorno", "Estornar lançamentos",
     "Desfazer qualquer lançamento da unidade, sem limite de tempo, e cancelar entradas."),
    ("ingredientes", "Cadastrar ingredientes",
     "Criar e editar ingredientes, categorias e estoque mínimo."),
    ("historico", "Ver histórico completo",
     "Ver todas as movimentações da unidade, de todos os usuários."),
    ("exportar", "Exportar planilhas (Excel)",
     "Baixar o estoque e o histórico da unidade em planilha Excel."),
    ("usuarios", "Gerenciar funcionários da unidade",
     "Cadastrar, editar e desativar funcionários da própria unidade."),
    ("encomendas", "Registrar encomendas (loja)",
     "Anotar encomendas de clientes na loja. Elas vão direto para o quadro da fábrica."),
    ("producao", "Quadro de encomendas (fábrica)",
     "Ver as encomendas de todas as lojas, imprimir, mudar o andamento, cancelar e cadastrar os produtos."),
]

# Perfis prontos (o master pode personalizar marcando as permissões uma a uma).
PROFILES = {
    "funcionario": ["baixa"],
    "compras": ["baixa", "entrada"],
    "gerente": [c[0] for c in CAPABILITIES if c[0] != "producao"],
    "atendente": ["encomendas"],
    "fabrica": ["baixa", "producao"],
}
CAPABILITY_CODES = [c[0] for c in CAPABILITIES]


class User(AbstractUser):
    is_master = models.BooleanField(
        "admin master", default=False,
        help_text="Acesso total a todas as unidades, usuários e configurações.",
    )
    establishment = models.ForeignKey(
        Establishment, on_delete=models.PROTECT, null=True, blank=True,
        related_name="users", verbose_name="unidade",
    )
    capabilities = models.JSONField("permissões", default=list, blank=True)

    class Meta:
        verbose_name = "usuário"
        verbose_name_plural = "usuários"

    @property
    def is_master_user(self) -> bool:
        return self.is_superuser or self.is_master

    def can(self, code: str) -> bool:
        return self.is_master_user or code in (self.capabilities or [])

    @property
    def effective_capabilities(self) -> list[str]:
        if self.is_master_user:
            return list(CAPABILITY_CODES)
        return [c for c in CAPABILITY_CODES if c in (self.capabilities or [])]

    def __str__(self):
        return self.get_full_name() or self.username
