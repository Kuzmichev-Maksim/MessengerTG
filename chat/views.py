from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db.models import Q
from django.shortcuts import redirect, render

from .forms import SignUpForm, StartDialogForm
from .models import Room


def signup_view(request):
    if request.user.is_authenticated:
        return redirect('chat-page')

    form = SignUpForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user)
        return redirect('chat-page')
    return render(request, 'registration/signup.html', {'form': form})


@login_required
def start_dialog(request):
    if request.method != 'POST':
        return redirect('chat-page')

    form = StartDialogForm(request.POST)
    if not form.is_valid():
        messages.error(request, 'Введите корректный username.')
        return redirect('chat-page')

    target_username = form.cleaned_data['username']
    if target_username == request.user.username:
        messages.error(request, 'Нельзя создать диалог с самим собой.')
        return redirect('chat-page')

    try:
        target_user = User.objects.get(username=target_username)
    except User.DoesNotExist:
        messages.error(request, 'Пользователь не найден.')
        return redirect('chat-page')

    room = Room.get_or_create_private_dialog(request.user, target_user)
    return redirect(f'/?room={room.slug}')


@login_required
def chat_page(request):
    lobby = Room.get_or_create_lobby()
    user_rooms = (
        Room.objects.filter(Q(is_private=False) | Q(participants=request.user))
        .distinct()
        .order_by('title')
    )
    selected_slug = request.GET.get('room') or lobby.slug
    selected_room = user_rooms.filter(slug=selected_slug).first() or lobby

    context = {
        'rooms': user_rooms,
        'selected_room': selected_room,
        'dialog_form': StartDialogForm(),
    }
    return render(request, 'chat/index.html', context)
