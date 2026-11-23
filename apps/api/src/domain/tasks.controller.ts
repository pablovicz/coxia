import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TaskService } from '@coxia/domain';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { completeTeamTaskSchema, teamTaskNoteSchema, teamTaskSchema, teamTasksQuery, webActor } from './schemas';

/** Tarefas da equipe (projeto opcional). Toda a equipe vê; quem edita comenta e encerra; apagar é da administração. */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TaskService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(teamTasksQuery)) q: z.infer<typeof teamTasksQuery>) {
    return this.tasks.list(user.organizationId, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.get(user.organizationId, id);
  }

  @Roles('owner', 'admin', 'staff')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(teamTaskSchema)) body: z.infer<typeof teamTaskSchema>) {
    return this.tasks.create(user.organizationId, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(teamTaskSchema)) body: z.infer<typeof teamTaskSchema>) {
    return this.tasks.update(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Post(':id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(completeTeamTaskSchema)) body: z.infer<typeof completeTeamTaskSchema>) {
    return this.tasks.complete(user.organizationId, id, body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Post(':id/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.reopen(user.organizationId, id, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Post(':id/notes')
  addNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(teamTaskNoteSchema)) body: z.infer<typeof teamTaskNoteSchema>) {
    return this.tasks.addNote(user.organizationId, id, body.body, webActor(user));
  }

  @Roles('owner', 'admin', 'staff')
  @Delete(':id/notes/:noteId')
  removeNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('noteId') noteId: string) {
    return this.tasks.removeNote(user.organizationId, id, noteId, webActor(user), user.role === 'owner' || user.role === 'admin');
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.remove(user.organizationId, id, webActor(user));
  }
}
