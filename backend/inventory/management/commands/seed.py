from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import Establishment, User
from inventory import services
from inventory.models import Category, Ingredient, StockItem
from orders.models import Order, OrderEvent, OrderItem, Product

PRODUCTS = {
    "Tortas": ["Torta de nozes", "Torta holandesa", "Torta de limão", "Torta de morango"],
    "Bolos": ["Bolo de chocolate", "Bolo red velvet", "Bolo de cenoura com brigadeiro", "Naked cake de frutas vermelhas"],
    "Doces": ["Brigadeiro gourmet (cento)", "Brownie (caixa com 6)", "Cheesecake de frutas vermelhas"],
    "Salgados": ["Quiche de alho-poró", "Empadão de frango"],
}

# (loja, cliente, telefone, dias a partir de hoje, hora, itens [(produto, qtd, obs)], observação, andamento)
SAMPLE_ORDERS = [
    ("centro", "Mariana Costa", "(21) 99812-3344", 1, "10:00",
     [("Torta de nozes", 1, "")], "Retirada na loja.", "agendado"),
    ("centro", "Rafael Lima", "(21) 98877-1020", 1, "15:30",
     [("Bolo de chocolate", 1, "Escrever “Parabéns, Júlia!”"), ("Brigadeiro gourmet (cento)", 2, "")], "", "producao"),
    ("jardins", "Fernanda Alves", "(21) 97654-2211", 2, "12:00",
     [("Cheesecake de frutas vermelhas", 1, ""), ("Brownie (caixa com 6)", 3, "")], "Cliente já pagou 50% no Pix.", "agendado"),
    ("jardins", "Paulo Henrique", "(21) 99100-7788", 0, "18:00",
     [("Quiche de alho-poró", 2, "")], "", "pronto"),
    ("centro", "Luciana Martins", "(21) 98234-5566", 5, "09:00",
     [("Naked cake de frutas vermelhas", 1, "Para 20 pessoas")], "Sem lactose se possível.", "agendado"),
]

CATALOG = {
    "Cafés e chás": [
        ("Café em grão", "kg", "3"), ("Café moído", "kg", "2"), ("Chá de camomila", "un", "20"),
    ],
    "Laticínios": [
        ("Leite integral", "L", "12"), ("Creme de leite", "L", "3"), ("Leite condensado", "kg", "4"),
        ("Manteiga", "kg", "2"), ("Cream cheese", "kg", "1.5"),
    ],
    "Secos e farinhas": [
        ("Farinha de trigo", "kg", "10"), ("Açúcar refinado", "kg", "8"), ("Açúcar mascavo", "kg", "2"),
        ("Fermento químico", "g", "300"),
    ],
    "Chocolates e coberturas": [
        ("Chocolate meio amargo", "kg", "3"), ("Cacau em pó", "kg", "1"), ("Granulado", "g", "500"),
    ],
    "Frutas": [("Morango", "kg", "3"), ("Limão", "un", "15"), ("Banana", "kg", "2")],
    "Ovos e frios": [("Ovos", "un", "60"), ("Presunto", "kg", "1"), ("Queijo muçarela", "kg", "2")],
    "Embalagens": [("Copo descartável 300 ml", "un", "200"), ("Embalagem de bolo", "un", "30")],
}

INITIAL = {
    "Café em grão": "8", "Café moído": "1.2", "Chá de camomila": "45",
    "Leite integral": "30", "Creme de leite": "2", "Leite condensado": "10",
    "Manteiga": "4", "Cream cheese": "0.8", "Farinha de trigo": "25",
    "Açúcar refinado": "20", "Açúcar mascavo": "3", "Fermento químico": "800",
    "Chocolate meio amargo": "6", "Cacau em pó": "1.5", "Granulado": "300",
    "Morango": "4", "Limão": "30", "Banana": "5", "Ovos": "120",
    "Presunto": "2", "Queijo muçarela": "3",
    "Copo descartável 300 ml": "500", "Embalagem de bolo": "12",
}

CONSUMPTION = [
    ("Café em grão", "750", "g"), ("Leite integral", "6", "L"), ("Ovos", "24", "un"),
    ("Morango", "1.5", "kg"), ("Farinha de trigo", "2", "kg"), ("Creme de leite", "500", "ml"),
    ("Chocolate meio amargo", "800", "g"), ("Leite condensado", "1.2", "kg"),
    ("Granulado", "300", "g"),
]


class Command(BaseCommand):
    help = "Cria unidades, usuários, ingredientes, produtos e encomendas de exemplo (Café Aurora)."

    def add_arguments(self, parser):
        parser.add_argument("--sem-movimentos", action="store_true",
                            help="Não lançar entradas e consumos de exemplo.")

    def _user(self, username, password, **fields):
        user, created = User.objects.get_or_create(username=username, defaults=fields)
        if created:
            user.set_password(password)
            user.save()
        return user

    @transaction.atomic
    def handle(self, *args, **opts):
        centro, _ = Establishment.objects.get_or_create(name="Café Aurora Centro")
        jardins, _ = Establishment.objects.get_or_create(name="Café Aurora Jardins")
        fabrica, _ = Establishment.objects.get_or_create(
            name="Café Aurora Fábrica", defaults={"kind": Establishment.Kind.FABRICA})

        admin = self._user("admin", "admin123", first_name="Administração", is_master=True,
                           is_staff=True, is_superuser=True)
        cozinha = self._user("cozinha", "cozinha123", first_name="Equipe", last_name="Cozinha",
                             establishment=centro, capabilities=["baixa"])
        self._user("compras", "compras123", first_name="Carlos", last_name="Compras",
                   establishment=centro, capabilities=["baixa", "entrada"])
        self._user("gerente", "gerente123", first_name="Gabriela", last_name="Gerente",
                   establishment=centro, capabilities=["baixa", "entrada", "ajuste", "estorno",
                                                       "ingredientes", "historico", "exportar", "usuarios"])
        cozinha2 = self._user("cozinha2", "cozinha123", first_name="Cozinha", last_name="Jardins",
                              establishment=jardins, capabilities=["baixa"])
        atendente = self._user("loja", "loja123", first_name="Atendimento", last_name="Centro",
                               establishment=centro, capabilities=["encomendas"])
        atendente2 = self._user("loja2", "loja123", first_name="Atendimento", last_name="Jardins",
                                establishment=jardins, capabilities=["encomendas"])
        self._user("fabrica", "fabrica123", first_name="Equipe", last_name="Fábrica",
                   establishment=fabrica, capabilities=["baixa", "producao"])

        for group, names in PRODUCTS.items():
            for name in names:
                Product.objects.get_or_create(name=name, defaults={"group": group})
        if not Order.objects.exists():
            self._sample_orders({"centro": (centro, atendente), "jardins": (jardins, atendente2)}, admin)

        for order, (cat_name, items) in enumerate(CATALOG.items()):
            cat, _ = Category.objects.get_or_create(name=cat_name, defaults={"order": order})
            for name, unit, minimum in items:
                ing, _ = Ingredient.objects.get_or_create(name=name, defaults={"category": cat, "unit": unit})
                for est in (centro, jardins, fabrica):
                    StockItem.objects.get_or_create(establishment=est, ingredient=ing,
                                                    defaults={"min_stock": Decimal(minimum)})

        if opts["sem_movimentos"] or Ingredient.objects.filter(movements__isnull=False).exists():
            self.stdout.write(self.style.SUCCESS("Cadastros prontos (movimentos existentes mantidos)."))
            return

        by_name = {i.name: i for i in Ingredient.objects.all()}
        for est, factor, kitchen in ((centro, Decimal("1"), cozinha), (jardins, Decimal("0.5"), cozinha2)):
            services.register_entry(
                establishment=est, user=admin, supplier="Atacadão Distribuidora",
                invoice_number="000.123.456" if est == centro else "000.987.001",
                invoice_date=date.today(), notes="Estoque inicial",
                items=[services.EntryItem(by_name[n].id, Decimal(q) * factor, by_name[n].unit)
                       for n, q in INITIAL.items()],
            )
            for name, qty, unit in CONSUMPTION:
                services.register_exit(establishment=est, user=kitchen, ingredient_id=by_name[name].id,
                                       quantity=Decimal(qty) * factor, unit=unit)

        self.stdout.write(self.style.SUCCESS(
            "Dados de exemplo criados (unidades: Café Aurora Centro, Café Aurora Jardins e Café Aurora Fábrica).\n"
            "  Admin master:            admin / admin123\n"
            "  Cozinha (Centro):        cozinha / cozinha123\n"
            "  Compras (Centro):        compras / compras123\n"
            "  Gerente (Centro):        gerente / gerente123\n"
            "  Cozinha (Jardins):       cozinha2 / cozinha123\n"
            "  Encomendas (Centro):     loja / loja123\n"
            "  Encomendas (Jardins):    loja2 / loja123\n"
            "  Fábrica (quadro):        fabrica / fabrica123"
        ))

    def _sample_orders(self, stores, admin):
        products = {p.name: p for p in Product.objects.all()}
        today = timezone.localdate()
        for key, customer, phone, days, hour, items, notes, status in SAMPLE_ORDERS:
            store, user = stores[key]
            h, m = map(int, hour.split(":"))
            due = timezone.make_aware(datetime.combine(today + timedelta(days=days), time(h, m)))
            if due < timezone.now():
                due = timezone.now() + timedelta(hours=2)
            order = Order.objects.create(store=store, customer_name=customer, customer_phone=phone,
                                         due_at=due, notes=notes, status=status, created_by=user)
            for name, qty, obs in items:
                OrderItem.objects.create(order=order, product=products[name], product_name=name,
                                         quantity=qty, notes=obs)
            OrderEvent.objects.create(order=order, action="criada", status="agendado", user=user)
            if status != "agendado":
                OrderEvent.objects.create(order=order, action="andamento", status=status, user=admin)
