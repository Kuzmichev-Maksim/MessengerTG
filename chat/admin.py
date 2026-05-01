from django.contrib import admin

from .models import Room, Message


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('title', 'slug', 'is_private', 'created_at')
    search_fields = ('title', 'slug')
    list_filter = ('is_private',)


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('room', 'author', 'created_at')
    search_fields = ('text', 'author__username', 'room__slug')
    list_filter = ('room',)
