from django.urls import path

from .views import chat_page, signup_view, start_dialog

urlpatterns = [
    path('', chat_page, name='chat-page'),
    path('signup/', signup_view, name='signup'),
    path('dialogs/start/', start_dialog, name='start-dialog'),
]
