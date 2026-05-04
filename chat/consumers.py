import json
from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import Message, Room

# In-process online counter
_online: dict[int, int] = {}


class ChatConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.room_slug = self.scope['url_route']['kwargs']['room_slug']
        self.room_group_name = f'chat_{self.room_slug}'
        self.user = self.scope['user']
        self.user_id = self.user.id if self.user.is_authenticated else None

        if not self.user.is_authenticated:
            await self.close(code=4401)
            return

        self.room = await self.get_room_for_user(self.room_slug, self.user_id)
        if not self.room:
            await self.close(code=4403)
            return

        self.room_id = self.room.id

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.channel_layer.group_add(f'user_status_{self.user_id}', self.channel_name)
        await self.accept()

        _online[self.user_id] = _online.get(self.user_id, 0) + 1

        # Отправляем статус другому пользователю (для приватных чатов)
        if self.room.is_private:
            other = await self.get_other_participant()
            if other:
                self.other_user_id = other.id
                await self.channel_layer.group_send(
                    f'user_status_{other.id}',
                    {'type': 'status.update', 'online': True},
                )
                await self.send(text_data=json.dumps({
                    'type': 'status',
                    'online': _online.get(other.id, 0) > 0,
                }))

        # Читаем сообщения и отправляем историю
        last_read_id = await self.mark_messages_read()
        if last_read_id is not None:
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'read.receipt', 'last_read_id': last_read_id},
            )

        history = await self.get_history()
        await self.send(text_data=json.dumps({'type': 'history', 'messages': history}))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        if self.user_id:
            await self.channel_layer.group_discard(f'user_status_{self.user_id}', self.channel_name)

        if self.user_id and self.user_id in _online:
            _online[self.user_id] -= 1
            if _online[self.user_id] <= 0:
                del _online[self.user_id]
                if hasattr(self, 'other_user_id') and self.other_user_id:
                    await self.channel_layer.group_send(
                        f'user_status_{self.other_user_id}',
                        {'type': 'status.update', 'online': False},
                    )

    # ==================== MAIN RECEIVE ====================
    async def receive(self, text_data):
        payload = json.loads(text_data)

        # === TYPING INDICATOR ===
        if payload.get('type') == 'typing':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat.typing',
                    'username': self.user.username,
                }
            )
            return

        # === REGULAR MESSAGE ===
        message = (payload.get('message') or '').strip()
        if not message:
            return

        reply_to_id = payload.get('reply_to_id')
        saved = await self.save_message(self.user_id, message, reply_to_id)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat.message',
                'author_id': self.user_id,
                **saved,
            },
        )

    # ==================== TYPING HANDLER ====================
    async def chat_typing(self, event):
        """Пересылаем информацию о печати клиенту"""
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'username': event['username'],
        }))

    # ==================== OTHER HANDLERS ====================
    async def chat_message(self, event):
        payload = {
            'type': 'message',
            'id': event['id'],
            'username': event['username'],
            'message': event['message'],
            'created_at': event['created_at'],
            'is_read': event.get('is_read', False),
        }
        if event.get('reply_to'):
            payload['reply_to'] = event['reply_to']

        await self.send(text_data=json.dumps(payload))

        if event.get('author_id') != self.user_id:
            await self.mark_single_message_read(event['id'])
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'read.receipt', 'last_read_id': event['id']},
            )

    async def read_receipt(self, event):
        await self.send(text_data=json.dumps({
            'type': 'read_receipt',
            'last_read_id': event['last_read_id'],
        }))

    async def status_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'status',
            'online': event['online'],
        }))

    # ==================== DB HELPERS (оставил без изменений) ====================
    @sync_to_async
    def mark_messages_read(self):
        ids = list(
            Message.objects
            .filter(room_id=self.room_id, is_read=False)
            .exclude(author_id=self.user_id)
            .values_list('id', flat=True)
        )
        if not ids:
            return None
        Message.objects.filter(id__in=ids).update(is_read=True)
        return max(ids)

    @sync_to_async
    def mark_single_message_read(self, message_id):
        Message.objects.filter(
            id=message_id, is_read=False
        ).exclude(author_id=self.user_id).update(is_read=True)

    @sync_to_async
    def save_message(self, user_id, message, reply_to_id=None):
        valid_reply_id = None
        if reply_to_id:
            try:
                Message.objects.get(id=reply_to_id, room_id=self.room_id)
                valid_reply_id = reply_to_id
            except Message.DoesNotExist:
                pass

        obj = Message.objects.create(
            room_id=self.room_id,
            author_id=user_id,
            text=message,
            reply_to_id=valid_reply_id,
        )
        obj = Message.objects.select_related('author', 'reply_to', 'reply_to__author').get(pk=obj.pk)
        return self._serialize(obj)

    @sync_to_async
    def get_history(self):
        latest = list(
            Message.objects
            .filter(room_id=self.room_id)
            .select_related('author', 'reply_to', 'reply_to__author')
            .order_by('-created_at')[:50]
        )
        latest.reverse()
        return [self._serialize(m) for m in latest]

    def _serialize(self, obj):
        data = {
            'id': obj.id,
            'username': obj.author.username if obj.author else 'Неизвестный',
            'message': obj.text,
            'created_at': obj.created_at.isoformat(),
            'is_read': obj.is_read,
        }
        if obj.reply_to:
            data['reply_to'] = {
                'id': obj.reply_to.id,
                'username': obj.reply_to.author.username if obj.reply_to.author else 'Неизвестный',
                'message': obj.reply_to.text,
            }
        return data

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