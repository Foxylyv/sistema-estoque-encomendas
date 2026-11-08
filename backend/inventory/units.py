"""Unidades de medida e conversão entre unidades compatíveis.

Cada unidade pertence a uma dimensão (massa, volume ou contagem) e possui um
fator em relação à unidade base da dimensão (g, ml, un). Só é possível converter
entre unidades da mesma dimensão — ex.: entrada em kg e consumo em g.
"""

from decimal import Decimal

from django.db import models


class Unit(models.TextChoices):
    KG = "kg", "Quilograma (kg)"
    G = "g", "Grama (g)"
    L = "L", "Litro (L)"
    ML = "ml", "Mililitro (ml)"
    UN = "un", "Unidade (un)"


MASS, VOLUME, COUNT = "massa", "volume", "contagem"

UNIT_INFO: dict[str, tuple[str, Decimal]] = {
    Unit.KG: (MASS, Decimal("1000")),
    Unit.G: (MASS, Decimal("1")),
    Unit.L: (VOLUME, Decimal("1000")),
    Unit.ML: (VOLUME, Decimal("1")),
    Unit.UN: (COUNT, Decimal("1")),
}


class IncompatibleUnits(ValueError):
    pass


def dimension(unit: str) -> str:
    return UNIT_INFO[unit][0]


def compatible_units(unit: str) -> list[str]:
    dim = dimension(unit)
    return [u for u, (d, _) in UNIT_INFO.items() if d == dim]


def convert(quantity: Decimal, from_unit: str, to_unit: str) -> Decimal:
    if from_unit == to_unit:
        return Decimal(quantity)
    from_dim, from_factor = UNIT_INFO[from_unit]
    to_dim, to_factor = UNIT_INFO[to_unit]
    if from_dim != to_dim:
        raise IncompatibleUnits(
            f"Não é possível converter {from_unit} para {to_unit} (unidades incompatíveis)."
        )
    return (Decimal(quantity) * from_factor / to_factor).quantize(Decimal("0.001"))
