import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
  listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  applyTemplate, resetTemplate, TemplateError,
} from '../template-service';
import type { CategoryNode } from '../template-service';

export interface TemplateRoutesOptions { db: Database }

export const templateRoutes: FastifyPluginCallback<TemplateRoutesOptions> = (app, opts, done) => {
  const { db } = opts;

  function handleError(e: unknown, reply: FastifyReply) {
    if (e instanceof TemplateError) return reply.code(e.statusCode).send({ error: e.message });
    const msg = e instanceof Error ? e.message : 'unknown error';
    return reply.code(500).send({ error: msg });
  }

  // GET /api/templates
  app.get('/api/templates', async (_req, reply) => {
    return reply.send({ templates: listTemplates(db) });
  });

  // GET /api/templates/:id
  app.get('/api/templates/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    const tpl = getTemplate(db, id);
    if (!tpl) return reply.code(404).send({ error: 'template not found' });
    return reply.send({ template: { ...tpl, tree: JSON.parse(tpl.tree) } });
  });

  // POST /api/templates
  app.post('/api/templates', async (req: FastifyRequest, reply) => {
    const body = req.body as Record<string, unknown> ?? {};
    const name = typeof body.name === 'string' ? body.name : '';
    const tree = Array.isArray(body.tree) ? body.tree as CategoryNode[] : [];
    try {
      const tpl = createTemplate(db, name, tree);
      return reply.send({ template: { ...tpl, tree: JSON.parse(tpl.tree) } });
    } catch (e) { return handleError(e, reply); }
  });

  // PUT /api/templates/:id
  app.put('/api/templates/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    const body = req.body as Record<string, unknown> ?? {};
    const patch: { name?: string; tree?: CategoryNode[] } = {};
    if (typeof body.name === 'string') patch.name = body.name;
    if (Array.isArray(body.tree)) patch.tree = body.tree as CategoryNode[];
    try {
      const tpl = updateTemplate(db, id, patch);
      if (!tpl) return reply.code(404).send({ error: 'template not found' });
      return reply.send({ template: { ...tpl, tree: JSON.parse(tpl.tree) } });
    } catch (e) { return handleError(e, reply); }
  });

  // DELETE /api/templates/:id
  app.delete('/api/templates/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    try {
      const ok = deleteTemplate(db, id);
      if (!ok) return reply.code(404).send({ error: 'template not found' });
      return reply.send({ success: true });
    } catch (e) { return handleError(e, reply); }
  });

  // POST /api/templates/:id/apply
  app.post('/api/templates/:id/apply', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    try {
      applyTemplate(db, id);
      return reply.send({ success: true });
    } catch (e) { return handleError(e, reply); }
  });

  // POST /api/templates/:id/reset
  app.post('/api/templates/:id/reset', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    try {
      resetTemplate(db, id);
      return reply.send({ success: true });
    } catch (e) { return handleError(e, reply); }
  });

  done();
};
