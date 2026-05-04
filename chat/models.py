from django.conf import settings
from django.db import models


class Room(models.Model):
    slug = models.SlugField(max_length=64, unique=True)
    title = models.CharField(max_length=100)
    is_private = models.BooleanField(default=False)
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='rooms',
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['title']

    def __str__(self):
        return self.title

    @classmethod
    def get_or_create_private_dialog(cls, user_a, user_b):
        first_id, second_id = sorted([user_a.id, user_b.id])
        slug = f'dialog-{first_id}-{second_id}'
        title = f'{user_a.username} / {user_b.username}'
        room, _ = cls.objects.get_or_create(
            slug=slug,
            defaults={
                'title': title,
                'is_private': True,
            },
        )
        room.participants.set([user_a, user_b])
        return room

    @classmethod
    def get_or_create_lobby(cls):
        room, _ = cls.objects.get_or_create(
            slug='lobby',
            defaults={
                'title': 'Общий чат',
                'is_private': False,
            },
        )
        if room.title != 'Общий чат':
            room.title = 'Общий чат'
            room.save(update_fields=['title'])
        return room


class Message(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='messages')
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='messages',
    )
    text = models.TextField(max_length=1000)
    reply_to = models.ForeignKey(
        'self', 
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='replies',
    )
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        author = self.author.username if self.author else 'Неизвестный'
        return f'[{self.room.slug}] {author}: {self.text[:30]}'