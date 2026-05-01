import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import Message, Room


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_slug = self.scope['url_route']['kwargs']['room_slug']
        self.room_group_name = f'chat_{self.room_slug}'

        if not self.scope['user'].is_authenticated:
            await self.close(code=4401)
            return

        self.room = await self.get_room_for_user(self.room_slug, self.scope['user'].id)
        if not self.room:
            await self.close(code=4403)
            return
        self.room_id = self.room.id

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        history = await self.get_history()
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'history',
                    'messages': history,
                }
            )
        )

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        payload = json.loads(text_data)
        message = (payload.get('message') or '').strip()

        if not message:
            return

        saved = await self.save_message(self.scope['user'].id, message)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat.message',
                'username': saved['username'],
                'message': saved['message'],
                'created_at': saved['created_at'],
            },
        )

    async def chat_message(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'message',
                    'username': event['username'],
                    'message': event['message'],
                    'created_at': event['created_at'],
                }
            )
        )

    @sync_to_async
    def save_message(self, user_id, message):
        obj = Message.objects.create(room_id=self.room_id, author_id=user_id, text=message)
        return {
            'username': obj.author.username if obj.author else 'Неизвестный',
            'message': obj.text,
            'created_at': obj.created_at.strftime('%H:%M:%S'),
        }

    @sync_to_async
    def get_history(self):
        latest = list(Message.objects.filter(room_id=self.room_id).order_by('-created_at')[:50])
        latest.reverse()
        return [
            {
                'username': item.author.username if item.author else 'Неизвестный',
                'message': item.text,
                'created_at': item.created_at.strftime('%H:%M:%S'),
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
