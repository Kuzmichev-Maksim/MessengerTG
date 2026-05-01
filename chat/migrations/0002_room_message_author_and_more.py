from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def assign_lobby_to_legacy_messages(apps, schema_editor):
    Room = apps.get_model('chat', 'Room')
    Message = apps.get_model('chat', 'Message')
    lobby, _ = Room.objects.get_or_create(
        slug='lobby',
        defaults={
            'title': 'Общий чат',
            'is_private': False,
        },
    )
    Message.objects.filter(room__isnull=True).update(room=lobby)


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Room',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=64, unique=True)),
                ('title', models.CharField(max_length=100)),
                ('is_private', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                (
                    'participants',
                    models.ManyToManyField(
                        blank=True,
                        related_name='rooms',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                'ordering': ['title'],
            },
        ),
        migrations.AddField(
            model_name='message',
            name='author',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='messages',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='message',
            name='room',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='messages',
                to='chat.room',
            ),
        ),
        migrations.RunPython(assign_lobby_to_legacy_messages, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='message',
            name='room',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='messages',
                to='chat.room',
            ),
        ),
        migrations.RemoveField(
            model_name='message',
            name='username',
        ),
    ]
