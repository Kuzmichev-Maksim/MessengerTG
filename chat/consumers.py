import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import Message, Room

# ─── In-process online counter ───────────────────────────────────────────────
# { user_id: number_of_open_connections }
# Works correctly for InMemoryChannelLayer (single process).
_online: dict[int, int] = {}


class ChatConsumer(AsyncWebsocketConsumer):

    # ── connect ──────────────────────────────────────────────────────────────
    async def connect(self):
        self.room_slug = self.scope['url_route']['kwargs']['room_slug']
        self.room_group_name = f'chat_{self.room_slug}'
        self.user = self.scope['user']
        self.user_id = self.user.id if self.user.is_authenticated else None
        self.other_user_id = None

        if not self.user.is_authenticated:
            await self.close(code=4401)
            return

        self.room = await self.get_room_for_user(self.room_slug, self.user_id)
        if not self.room:
            await self.close(code=4403)
            return
        self.room_id = self.room.id

        # Join the chat group and the personal status group
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.channel_layer.group_add(f'user_status_{self.user_id}', self.channel_name)
        await self.accept()

        # Mark this user as online (increment connection counter)
        _online[self.user_id] = _online.get(self.user_id, 0) + 1

        # Private room: find the other participant
        if self.room.is_private:
            other = await self.get_other_participant()
            if other:
                self.other_user_id = other.id

                # Tell the other person that we just came online
                await self.channel_layer.group_send(
                    f'user_status_{other.id}',
                    {
                        'type': 'status.update',
                        'online': True,
                    },
                )

                # Tell ourselves whether the other person is currently online
                await self.send(text_data=json.dumps({
                    'type': 'status',
                    'online': _online.get(other.id, 0) > 0,
                }))

        # Send message history
        history = await self.get_history()
        await self.send(text_data=json.dumps({'type': 'history', 'messages': history}))

    # ── disconnect ───────────────────────────────────────────────────────────
    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        if self.user_id:
            await self.channel_layer.group_discard(
                f'user_status_{self.user_id}', self.channel_name
            )

        # Decrement connection counter; notify other side only when fully offline
        if self.user_id and self.user_id in _online:
            _online[self.user_id] -= 1
            if _online[self.user_id] <= 0:
                del _online[self.user_id]
                if self.other_user_id:
                    await self.channel_layer.group_send(
                        f'user_status_{self.other_user_id}',
                        {
                            'type': 'status.update',
                            'online': False,
                        },
                    )

    # ── receive (incoming message from browser) ───────────────────────────────
    async def receive(self, text_data):
        payload = json.loads(text_data)
        message = (payload.get('message') or '').strip()
        if not message:
            return

        saved = await self.save_message(self.user_id, message)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat.message',
                'username': saved['username'],
                'message': saved['message'],
                'created_at': saved['created_at'],
            },
        )

    # ── channel-layer event handlers ─────────────────────────────────────────
    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message',
            'username': event['username'],
            'message': event['message'],
            'created_at': event['created_at'],
        }))

    async def status_update(self, event):
        """Push the other user's online/offline status to our browser."""
        await self.send(text_data=json.dumps({
            'type': 'status',
            'online': event['online'],
        }))

    # ── DB helpers ───────────────────────────────────────────────────────────
    @sync_to_async
    def save_message(self, user_id, message):
        obj = Message.objects.create(
            room_id=self.room_id, author_id=user_id, text=message
        )
        return {
            'username': obj.author.username if obj.author else 'Неизвестный',
            'message': obj.text,
            'created_at': obj.created_at.isoformat(),
        }

    @sync_to_async
    def get_history(self):
        latest = list(
            Message.objects.filter(room_id=self.room_id).order_by('-created_at')[:50]
        )
        latest.reverse()
        return [
            {
                'username': item.author.username if item.author else 'Неизвестный',
                'message': item.text,
                'created_at': item.created_at.isoformat(),
            }
            for item in latest
        ]

    @sync_to_async
    def get_room_for_user(self, room_slug, user_id):
        try:
            room = Room.objects.get(slug=room_slug)
        except Room.DoesNotExist:
            return None
        if room.is_private and not room.participants.filter(id=user_id).exists():
            return None
        return room

    @sync_to_async
    def get_other_participant(self):
        return self.room.participants.exclude(id=self.user_id).first()