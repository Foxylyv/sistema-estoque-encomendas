from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import CAPABILITY_CODES, Establishment, User


class EstablishmentSerializer(serializers.ModelSerializer):
    user_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Establishment
        fields = ["id", "name", "address", "kind", "active", "user_count"]


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)
    full_name = serializers.SerializerMethodField()
    is_master_user = serializers.BooleanField(read_only=True)
    effective_capabilities = serializers.ListField(read_only=True)
    establishment_name = serializers.CharField(source="establishment.name", read_only=True, default=None)
    capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CAPABILITY_CODES), required=False
    )

    class Meta:
        model = User
        fields = [
            "id", "username", "first_name", "last_name", "full_name", "email",
            "is_master", "is_master_user", "establishment", "establishment_name",
            "capabilities", "effective_capabilities", "is_active", "password", "last_login",
        ]
        read_only_fields = ["last_login"]

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError({"password": "Informe uma senha."})
        is_master = attrs.get("is_master", getattr(self.instance, "is_master", False))
        est = attrs.get("establishment", getattr(self.instance, "establishment", None))
        request = self.context.get("request")
        if request and not request.user.is_master_user:
            est = est or request.user.establishment
        if not is_master and est is None:
            raise serializers.ValidationError({"establishment": "Escolha a unidade do funcionário."})
        if "capabilities" in attrs:
            attrs["capabilities"] = sorted(set(attrs["capabilities"]), key=CAPABILITY_CODES.index)
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if password:
            instance.set_password(password)
        instance.save()
        return instance
