from django.conf import settings
from django.db import models

from accounts.models import Establishment


class Product(models.Model):
    """Produto do catálogo da fábrica (ex.: Torta de nozes). Igual para todas as lojas."""

    name = models.CharField("nome", max_length=120, unique=True)
    group = models.CharField("grupo", max_length=60, blank=True,
                             help_text="Ex.: Tortas, Bolos, Doces. Usado para agrupar na tela da loja.")
    description = models.CharField("descrição", max_length=255, blank=True)
    active = models.BooleanField("ativo", default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["group", "name"]
        verbose_name = "produto"

    def __str__(self):
        return self.name


class Order(models.Model):
    """Encomenda de cliente feita numa loja e produzida pela fábrica.

    Depois de registrada, a encomenda não é editada: só muda de andamento
    (pela fábrica) ou é cancelada (pela fábrica ou pelo admin master).
    """

    class Status(models.TextChoices):
        AGENDADO = "agendado", "Agendado"
        PRODUCAO = "producao", "Em produção"
        PRONTO = "pronto", "Pronto"
        ENVIADO = "enviado", "Enviado à loja"
        CANCELADO = "cancelado", "Cancelado"

    store = models.ForeignKey(Establishment, on_delete=models.PROTECT, related_name="orders",
                              verbose_name="loja")
    customer_name = models.CharField("cliente", max_length=120)
    customer_phone = models.CharField("telefone", max_length=30, blank=True)
    due_at = models.DateTimeField("entregar em", db_index=True)
    notes = models.TextField("observações", blank=True)
    status = models.CharField("andamento", max_length=10, choices=Status.choices,
                              default=Status.AGENDADO, db_index=True)
    status_changed_at = models.DateTimeField("andamento alterado em", auto_now_add=True)
    printed_at = models.DateTimeField("impressa em", null=True, blank=True)
    cancel_reason = models.CharField("motivo do cancelamento", max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                   related_name="orders", verbose_name="registrada por")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["due_at", "id"]
        verbose_name = "encomenda"

    def __str__(self):
        return f"#{self.pk} {self.customer_name}"


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="order_items")
    # Nome guardado na hora da encomenda: renomear o produto depois não muda a comanda.
    product_name = models.CharField("produto", max_length=120)
    quantity = models.PositiveIntegerField("quantidade")
    notes = models.CharField("observação do item", max_length=255, blank=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "item da encomenda"
        verbose_name_plural = "itens da encomenda"

    def __str__(self):
        return f"{self.quantity}× {self.product_name}"


class OrderEvent(models.Model):
    """Histórico da encomenda: criação, mudanças de andamento, impressão e cancelamento."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="events")
    status = models.CharField("andamento", max_length=10, choices=Order.Status.choices, blank=True)
    action = models.CharField("ação", max_length=20)  # criada, andamento, impressa, cancelada
    note = models.CharField("observação", max_length=255, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="order_events")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "evento da encomenda"
        verbose_name_plural = "eventos da encomenda"
