from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Establishment, User

from .models import Order, Product


class OrderApiTests(TestCase):
    def setUp(self):
        self.centro = Establishment.objects.create(name="Centro")
        self.jardins = Establishment.objects.create(name="Jardins")
        self.fabrica = Establishment.objects.create(name="Fábrica", kind=Establishment.Kind.FABRICA)
        self.master = User.objects.create_user("adm", password="x12345", is_master=True)
        self.loja = User.objects.create_user("loja", password="x12345", establishment=self.centro,
                                             capabilities=["encomendas"])
        self.loja2 = User.objects.create_user("loja2", password="x12345", establishment=self.jardins,
                                              capabilities=["encomendas"])
        self.cozinha = User.objects.create_user("coz", password="x12345", establishment=self.centro,
                                                capabilities=["baixa"])
        self.fab = User.objects.create_user("fab", password="x12345", establishment=self.fabrica,
                                            capabilities=["producao"])
        # "producao" numa loja não dá acesso ao quadro.
        self.gerente_producao = User.objects.create_user(
            "ger", password="x12345", establishment=self.centro, capabilities=["encomendas", "producao"])
        self.torta = Product.objects.create(name="Torta de nozes", group="Tortas")
        self.api = APIClient()

    def as_(self, user, est=None):
        self.api.force_authenticate(user)
        self.api.credentials(**({"HTTP_X_ESTABLISHMENT": str(est.id)} if est else {}))
        return self.api

    def create(self, user=None, est=None, **extra):
        body = {
            "customer_name": "Mariana", "customer_phone": "(21) 99999-0000",
            "due_at": (timezone.now() + timedelta(days=2)).isoformat(),
            "items": [{"product": self.torta.id, "quantity": 1, "notes": "sem açúcar"}],
            **extra,
        }
        return self.as_(user or self.loja, est).post("/api/orders/", body, format="json")

    def test_store_creates_order_for_its_own_store(self):
        r = self.create()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["store"], self.centro.id)
        self.assertEqual(r.data["status"], "agendado")
        self.assertEqual(r.data["items"][0]["product_name"], "Torta de nozes")
        order = Order.objects.get()
        self.assertEqual(order.events.get().action, "criada")

    def test_product_name_is_kept_after_rename(self):
        self.create()
        self.torta.name = "Torta de nozes especial"
        self.torta.save()
        r = self.as_(self.fab).get("/api/orders/", {"quadro": 1})
        self.assertEqual(r.data[0]["items"][0]["product_name"], "Torta de nozes")

    def test_validation(self):
        past = (timezone.now() - timedelta(hours=2)).isoformat()
        self.assertEqual(self.create(due_at=past).status_code, 400)
        self.assertEqual(self.create(items=[]).status_code, 400)
        self.assertEqual(self.create(customer_name="  ").status_code, 400)
        self.assertEqual(self.create(items=[{"product": self.torta.id, "quantity": 0}]).status_code, 400)
        self.torta.active = False
        self.torta.save()
        self.assertEqual(self.create().status_code, 400)

    def test_factory_cannot_create_and_kitchen_has_no_access(self):
        self.assertEqual(self.create(user=self.fab).status_code, 403)
        self.assertEqual(self.create(user=self.cozinha).status_code, 403)
        self.assertEqual(self.as_(self.cozinha).get("/api/orders/").status_code, 403)

    def test_master_creates_from_selected_store(self):
        r = self.create(user=self.master, est=self.jardins)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["store"], self.jardins.id)
        self.assertEqual(self.create(user=self.master, est=self.fabrica).status_code, 403)

    def test_visibility(self):
        self.create()
        self.create(user=self.loja2)
        self.assertEqual(self.as_(self.loja).get("/api/orders/").data["count"], 1)
        self.assertEqual(self.as_(self.loja2).get("/api/orders/").data["count"], 1)
        # Fábrica e master (com a fábrica selecionada) veem todas.
        self.assertEqual(len(self.as_(self.fab).get("/api/orders/", {"quadro": 1}).data), 2)
        self.assertEqual(len(self.as_(self.master, self.fabrica).get("/api/orders/", {"quadro": 1}).data), 2)
        # "producao" numa loja não libera as encomendas das outras lojas.
        self.assertEqual(self.as_(self.gerente_producao).get("/api/orders/").data["count"], 1)
        other = Order.objects.get(store=self.jardins)
        self.assertEqual(self.as_(self.loja).get(f"/api/orders/{other.id}/").status_code, 404)

    def test_no_edit_or_delete(self):
        oid = self.create().data["id"]
        api = self.as_(self.loja)
        self.assertEqual(api.patch(f"/api/orders/{oid}/", {"customer_name": "X"}, format="json").status_code, 405)
        self.assertEqual(api.delete(f"/api/orders/{oid}/").status_code, 405)

    def test_status_flow_only_by_factory(self):
        oid = self.create().data["id"]
        url = f"/api/orders/{oid}/andamento/"
        self.assertEqual(self.as_(self.loja).post(url, {"status": "pronto"}, format="json").status_code, 403)
        self.assertEqual(self.as_(self.gerente_producao).post(url, {"status": "pronto"}, format="json").status_code, 403)
        r = self.as_(self.fab).post(url, {"status": "producao"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "producao")
        self.assertEqual(self.as_(self.fab).post(url, {"status": "cancelado"}, format="json").status_code, 400)
        # A loja acompanha o andamento.
        self.assertEqual(self.as_(self.loja).get(f"/api/orders/{oid}/").data["status"], "producao")

    def test_cancel(self):
        oid = self.create().data["id"]
        url = f"/api/orders/{oid}/cancelar/"
        self.assertEqual(self.as_(self.loja).post(url, {"reason": "cliente desistiu"}, format="json").status_code, 403)
        self.assertEqual(self.as_(self.fab).post(url, {"reason": " "}, format="json").status_code, 400)
        r = self.as_(self.fab).post(url, {"reason": "Cliente desistiu"}, format="json")
        self.assertEqual(r.data["status"], "cancelado")
        self.assertEqual(r.data["cancel_reason"], "Cliente desistiu")
        self.assertEqual(self.as_(self.fab).post(url, {"reason": "de novo"}, format="json").status_code, 400)
        self.assertEqual(self.as_(self.fab).post(f"/api/orders/{oid}/andamento/", {"status": "pronto"},
                                                 format="json").status_code, 400)
        self.assertEqual(len(self.as_(self.fab).get("/api/orders/", {"quadro": 1}).data), 0)

    def test_board_hides_old_sent_orders(self):
        a = self.create().data["id"]
        b = self.create().data["id"]
        for oid in (a, b):
            self.as_(self.fab).post(f"/api/orders/{oid}/andamento/", {"status": "enviado"}, format="json")
        Order.objects.filter(pk=a).update(status_changed_at=timezone.now() - timedelta(days=2))
        ids = [o["id"] for o in self.as_(self.fab).get("/api/orders/", {"quadro": 1}).data]
        self.assertEqual(ids, [b])

    def test_mark_printed(self):
        oid = self.create().data["id"]
        # A loja imprimir a via do cliente não tira o aviso da fábrica.
        self.as_(self.loja).post("/api/orders/impressas/", {"ids": [oid]}, format="json")
        self.assertIsNone(Order.objects.get().printed_at)
        r = self.as_(self.fab).post("/api/orders/impressas/", {"ids": [oid]}, format="json")
        self.assertEqual(r.data["marked"], 1)
        self.assertIsNotNone(Order.objects.get().printed_at)
        r = self.as_(self.fab).post("/api/orders/impressas/", {"ids": [oid]}, format="json")
        self.assertEqual(r.data["marked"], 0)

    def test_filter_by_due_date(self):
        self.create(due_at=(timezone.now() + timedelta(days=1)).isoformat())
        self.create(due_at=(timezone.now() + timedelta(days=5)).isoformat())
        day = (timezone.localdate() + timedelta(days=5)).isoformat()
        r = self.as_(self.fab).get("/api/orders/", {"todas": 1, "de": day, "ate": day})
        self.assertEqual(len(r.data), 1)


class ProductApiTests(TestCase):
    def setUp(self):
        fabrica = Establishment.objects.create(name="Fábrica", kind=Establishment.Kind.FABRICA)
        centro = Establishment.objects.create(name="Centro")
        self.fab = User.objects.create_user("fab", password="x", establishment=fabrica, capabilities=["producao"])
        self.loja = User.objects.create_user("loja", password="x", establishment=centro,
                                             capabilities=["encomendas", "producao"])
        self.api = APIClient()

    def test_only_factory_manages_catalog(self):
        self.api.force_authenticate(self.loja)
        self.assertEqual(self.api.post("/api/products/", {"name": "Bolo"}).status_code, 403)
        self.assertEqual(self.api.get("/api/products/").status_code, 200)
        self.api.force_authenticate(self.fab)
        r = self.api.post("/api/products/", {"name": " Bolo de cenoura ", "group": "Bolos"})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["name"], "Bolo de cenoura")
        self.assertEqual(self.api.get("/api/products/grupos/").data, ["Bolos"])
