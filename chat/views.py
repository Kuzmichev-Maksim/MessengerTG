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
    # Only private dialogs that the current user participates in
    user_rooms = list(
        Room.objects
        .filter(is_private=True, participants=request.user)
        .distinct()
        .prefetch_related('participants')
        .order_by('title')
    )

    # Annotate each room with the other participant's username as display_title
    me = request.user
    for room in user_rooms:
        other = next(
            (p for p in room.participants.all() if p.id != me.id),
            None,
        )
        room.display_title = other.username if other else room.title
        room.other_username = other.username if other else ''

    selected_slug = request.GET.get('room')
    selected_room = None
    if selected_slug:
        selected_room = next((r for r in user_rooms if r.slug == selected_slug), None)

    context = {
        'rooms': user_rooms,
        'selected_room': selected_room,
    }
    return render(request, 'chat/index.html', context)