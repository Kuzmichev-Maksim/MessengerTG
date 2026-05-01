from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User


class SignUpForm(UserCreationForm):
    username = forms.CharField(max_length=150, label='Имя пользователя')
    password1 = forms.CharField(
        label='Пароль',
        widget=forms.PasswordInput,
    )
    password2 = forms.CharField(
        label='Подтверждение пароля',
        widget=forms.PasswordInput,
    )

    class Meta:
        model = User
        fields = ('username', 'password1', 'password2')


class StartDialogForm(forms.Form):
    username = forms.CharField(max_length=150, label='Имя пользователя')
