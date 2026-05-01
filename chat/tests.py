from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User

from .models import Room


class AuthAndChatFlowTests(TestCase):
    def test_signup_creates_user_and_redirects(self):
        response = self.client.post(
            reverse('signup'),
            {
                'username': 'alice',
                'password1': 'StrongPass123!',
                'password2': 'StrongPass123!',
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertTrue(User.objects.filter(username='alice').exists())

    def test_chat_requires_authentication(self):
        response = self.client.get(reverse('chat-page'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response.url)

    def test_start_dialog_creates_private_room(self):
        alice = User.objects.create_user(username='alice', password='StrongPass123!')
        User.objects.create_user(username='bob', password='StrongPass123!')
        self.client.force_login(alice)

        response = self.client.post(reverse('start-dialog'), {'username': 'bob'})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Room.objects.filter(is_private=True).count(), 1)
