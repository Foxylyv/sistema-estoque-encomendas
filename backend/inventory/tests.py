from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Establishment, User

from .models import Category, Ingredient, Movement, StockItem
from .units import convert


class UnitTests(TestCase):
    def test_convert_kg_to_g(self):
        self.assertEqual(convert(Decimal("1.5"), "kg", "g"), Decimal("1500"))

    def test_convert_ml_to_l(self):
        self.assertEqual(convert(Decimal("250"), "ml", "L"), Decimal("0.25"))

    def test_incompatible(self):
        with self.assertRaises(ValueError):
            convert(Decimal("1"), "kg", "L")


class StockApiTests(TestCase):
    def setUp(self):
        self.est = Establishment.objects.create(name="Centro")
        self.other = Establishment.objects.create(name="Jardins")
        self.master = User.objects.create_user("adm", password="x12345", is_master=True)
        self.kitchen = User.objects.create_user("coz", password="x12345", establishment=self.est,
                                                capabilities=["baixa"])
        self.buyer = User.objects.create_user("comp", password="x12345", establishment=self.est,
                                              capabilities=["entrada"])
        cat = Category.objects.create(name="Secos")
        self.flour = Ingredient.objects.create(name="Farinha", category=cat, unit="kg")
        StockItem.objects.create(establishment=self.est, ingredient=self.flour, min_stock=Decimal("2"))
        self.api = APIClient()

    def as_(self, user, est=None):
        self.api.force_authenticate(user)
        self.api.credentials(HTTP_X_ESTABLISHMENT=str((est or self.est).id))
        return self.api

    def stock(self, est=None):
        item = StockItem.objects.filter(establishment=est or self.est, ingredient=self.flour).first()
        return item.stock if item else Decimal("0")

    def entry(self, qty="5", unit="kg", user=None, est=None):
        return self.as_(user or self.master, est).post("/api/entries/", {
            "supplier": "Fornecedor X", "invoice_number": "123",
            "invoice_date": str(date.today()),
            "items": [{"ingredient": self.flour.id, "quantity": qty, "unit": unit, "total_cost": "30.00"}],
        }, format="json")

    def exit(self, qty, unit="g", user=None):
        return self.as_(user or self.kitchen).post("/api/movements/saida/", {
            "ingredient": self.flour.id, "quantity": qty, "unit": unit,
        }, format="json")

    def test_entry_adds_and_exit_converts_units(self):
        r = self.entry()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["total_cost"], Decimal("30.00"))
        r = self.exit("500")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.stock(), Decimal("4.5"))
        self.assertEqual(r.data["user"], self.kitchen.id)

    def test_buyer_with_permission_can_register_entry(self):
        self.assertEqual(self.entry(user=self.buyer).status_code, 201)

    def test_kitchen_cannot_register_entry(self):
        self.assertEqual(self.entry(user=self.kitchen).status_code, 403)

    def test_buyer_without_baixa_cannot_exit(self):
        self.entry()
        self.assertEqual(self.exit("1", "kg", user=self.buyer).status_code, 403)

    def test_kitchen_cannot_edit_ingredients(self):
        r = self.as_(self.kitchen).patch(f"/api/ingredients/{self.flour.id}/", {"min_stock": 1}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_stock_is_per_establishment(self):
        self.entry(est=self.other)
        self.assertEqual(self.stock(self.other), Decimal("5"))
        self.assertEqual(self.stock(), Decimal("0"))
        # Funcionário do Centro não enxerga a outra unidade, mesmo enviando o cabeçalho.
        r = self.as_(self.kitchen, self.other).get("/api/ingredients/")
        self.assertEqual(Decimal(str(r.data["results"][0]["stock"])), Decimal("0"))

    def test_create_ingredient_with_initial_stock(self):
        r = self.as_(self.master).post("/api/ingredients/", {
            "name": "Açúcar", "category": self.flour.category_id, "unit": "kg",
            "min_stock": "1", "initial_quantity": "2500", "initial_unit": "g",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Decimal(str(r.data["stock"])), Decimal("2.5"))
        mov = Movement.objects.get(ingredient_id=r.data["id"])
        self.assertEqual(mov.kind, Movement.Kind.INICIAL)

    def test_exit_above_balance_blocked(self):
        self.entry("1")
        r = self.exit("2", "kg")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data["code"], "insufficient_stock")
        self.assertEqual(self.stock(), Decimal("1"))

    @override_settings(ESTOQUE_PERMITIR_SALDO_NEGATIVO=True)
    def test_exit_above_balance_allowed_by_setting(self):
        self.assertEqual(self.exit("1", "kg").status_code, 201)
        self.assertEqual(self.stock(), Decimal("-1"))

    def test_incompatible_unit_rejected(self):
        self.entry()
        self.assertEqual(self.exit("1", "L").status_code, 400)

    def test_reverse_preserves_history(self):
        self.entry()
        mov_id = self.exit("1", "kg").data["id"]
        r = self.as_(self.kitchen).post(f"/api/movements/{mov_id}/estornar/", {}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.stock(), Decimal("5"))
        self.assertEqual(Movement.objects.count(), 3)
        r = self.as_(self.master).post(f"/api/movements/{mov_id}/estornar/", {}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_kitchen_undo_window_expires(self):
        self.entry()
        mov_id = self.exit("1", "kg").data["id"]
        later = timezone.now() + timedelta(minutes=30)
        with patch("inventory.services.timezone.now", return_value=later):
            r = self.as_(self.kitchen).post(f"/api/movements/{mov_id}/estornar/", {}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_manual_adjustment(self):
        self.entry()
        r = self.as_(self.master).post("/api/movements/ajuste/", {
            "ingredient": self.flour.id, "counted_quantity": "3200", "unit": "g", "notes": "Inventário",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.stock(), Decimal("3.2"))
        self.assertEqual(Decimal(str(r.data["quantity"])), Decimal("-1.8"))
        self.assertEqual(Decimal(str(r.data["balance_before"])), Decimal("5"))

    def test_adjustment_requires_permission(self):
        r = self.as_(self.kitchen).post("/api/movements/ajuste/", {
            "ingredient": self.flour.id, "counted_quantity": "1", "unit": "kg", "notes": "x",
        }, format="json")
        self.assertEqual(r.status_code, 403)

    def test_cancel_entry(self):
        entry_id = self.entry().data["id"]
        r = self.as_(self.master).post(f"/api/entries/{entry_id}/cancelar/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["is_cancelled"])
        self.assertEqual(self.stock(), Decimal("0"))

    def test_low_stock_filter_and_dashboard(self):
        self.entry("1.5")
        r = self.as_(self.kitchen).get("/api/ingredients/?status=alerta")
        self.assertEqual(r.data["count"], 1)
        d = self.as_(self.kitchen).get("/api/dashboard/").data
        self.assertEqual(d["totals"]["low"], 1)

    def test_history_visibility(self):
        self.entry()
        self.exit("100")
        self.assertEqual(self.as_(self.kitchen).get("/api/movements/").data["count"], 1)
        self.assertEqual(self.as_(self.master).get("/api/movements/").data["count"], 2)

    def test_history_ordering(self):
        self.entry()
        self.exit("100")
        r = self.as_(self.master).get("/api/movements/?ordering=quantity")
        self.assertEqual(r.data["results"][0]["kind"], "consumo")

    def test_exports(self):
        self.entry()
        r = self.as_(self.master).get("/api/movements/export/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("spreadsheetml", r["Content-Type"])
        # Só master e quem tem "exportar" (gerente).
        self.assertEqual(self.as_(self.kitchen).get("/api/ingredients/export/").status_code, 403)
        self.assertEqual(self.as_(self.kitchen).get("/api/movements/export/").status_code, 403)
        self.assertEqual(self.as_(self.buyer).get("/api/ingredients/export/").status_code, 403)
        manager = User.objects.create_user("ger", password="x12345", establishment=self.est,
                                           capabilities=["historico", "exportar"])
        self.assertEqual(self.as_(manager).get("/api/ingredients/export/").status_code, 200)
        self.assertEqual(self.as_(manager).get("/api/movements/export/").status_code, 200)

    def test_cannot_change_unit_after_movements(self):
        self.entry()
        r = self.as_(self.master).patch(f"/api/ingredients/{self.flour.id}/", {"unit": "g"}, format="json")
        self.assertEqual(r.status_code, 400)


class UserAdminTests(TestCase):
    def setUp(self):
        self.est = Establishment.objects.create(name="Centro")
        self.master = User.objects.create_user("adm", password="x12345", is_master=True)
        self.api = APIClient()
        self.api.force_authenticate(self.master)

    def test_employee_requires_establishment(self):
        r = self.api.post("/api/users/", {"username": "x", "first_name": "X", "password": "abc12345",
                                          "capabilities": ["baixa"]}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.api.post("/api/users/", {"username": "x", "first_name": "X", "password": "abc12345",
                                          "capabilities": ["baixa", "entrada"], "establishment": self.est.id},
                          format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["effective_capabilities"], ["baixa", "entrada"])

    def test_only_master_manages_establishments(self):
        emp = User.objects.create_user("e", password="x12345", establishment=self.est,
                                       capabilities=["historico", "ingredientes"])
        self.api.force_authenticate(emp)
        self.assertEqual(self.api.post("/api/establishments/", {"name": "Nova"}).status_code, 403)
        self.assertEqual(len(self.api.get("/api/establishments/").data), 1)


class ManagerTests(TestCase):
    def setUp(self):
        self.est = Establishment.objects.create(name="Centro")
        self.other = Establishment.objects.create(name="Jardins")
        self.manager = User.objects.create_user("ger", password="x12345", establishment=self.est,
                                                capabilities=["baixa", "usuarios"])
        User.objects.create_user("master", password="x12345", is_master=True)
        User.objects.create_user("fora", password="x12345", establishment=self.other, capabilities=["baixa"])
        self.api = APIClient()
        self.api.force_authenticate(self.manager)

    def test_manager_sees_only_own_unit_employees(self):
        names = [u["username"] for u in self.api.get("/api/users/").data["results"]]
        self.assertEqual(names, ["ger"])

    def test_manager_creates_employee_in_own_unit(self):
        r = self.api.post("/api/users/", {"username": "novo", "first_name": "N", "password": "abc12345",
                                          "capabilities": ["baixa"]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["establishment"], self.est.id)

    def test_manager_cannot_create_master_or_other_unit(self):
        base = {"first_name": "N", "password": "abc12345", "capabilities": ["baixa"]}
        r = self.api.post("/api/users/", {**base, "username": "m", "is_master": True}, format="json")
        self.assertEqual(r.status_code, 403)
        r = self.api.post("/api/users/", {**base, "username": "o", "establishment": self.other.id}, format="json")
        self.assertEqual(r.status_code, 403)


class NetworkDashboardTests(TestCase):
    def setUp(self):
        self.a = Establishment.objects.create(name="A")
        self.b = Establishment.objects.create(name="B")
        self.master = User.objects.create_user("m", password="x12345", is_master=True)
        cat = Category.objects.create(name="Secos")
        self.ing = Ingredient.objects.create(name="Farinha", category=cat, unit="kg")
        StockItem.objects.create(establishment=self.a, ingredient=self.ing, min_stock=Decimal("2"))
        StockItem.objects.create(establishment=self.b, ingredient=self.ing, min_stock=Decimal("2"))
        from . import services
        services.register_entry(establishment=self.a, user=self.master, supplier="X", invoice_date=date.today(),
                                items=[services.EntryItem(self.ing.id, Decimal("10"), "kg", Decimal("50"))])
        services.register_exit(establishment=self.a, user=self.master, ingredient_id=self.ing.id,
                               quantity=Decimal("1"), unit="kg")
        self.api = APIClient()

    def test_master_sees_consolidated_numbers(self):
        self.api.force_authenticate(self.master)
        d = self.api.get("/api/dashboard/rede/").data
        self.assertEqual(d["totals"]["units"], 2)
        self.assertEqual(d["totals"]["zero"], 1)  # unidade B sem saldo
        self.assertEqual(d["totals"]["purchases_30d"], Decimal("50"))
        row = d["matrix"][0]
        self.assertEqual(row["total"], Decimal("9"))
        self.assertEqual(row["per"][self.b.id]["status"], "zerado")
        self.assertEqual(d["top_consumed"][0]["per"][self.a.id], Decimal("1"))

    def test_employee_forbidden(self):
        emp = User.objects.create_user("e", password="x12345", establishment=self.a,
                                       capabilities=["historico", "usuarios"])
        self.api.force_authenticate(emp)
        self.assertEqual(self.api.get("/api/dashboard/rede/").status_code, 403)
