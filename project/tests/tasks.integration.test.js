const { PostgreSqlContainer } = require('@testcontainers/postgresql');
const request = require('supertest');

let container;
let app;
let server;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('taskflow_test')
    .withUsername('testuser')
    .withPassword('testpassword')
    .start();

  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getMappedPort(5432));
  process.env.DB_NAME = 'taskflow_test';
  process.env.DB_USER = 'testuser';
  process.env.DB_PASSWORD = 'testpassword';

  jest.resetModules();
  app = require('../src/index');

  await new Promise((r) => setTimeout(r, 500));
});

afterAll(async () => {
  // End the pg pool first so no idle connections remain when the container stops
  const { pool } = require('../src/index');
  if (pool) await pool.end().catch(() => {});
  if (container) await container.stop();
});

describe('GET /health', () => {
  it('returns 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Tasks CRUD', () => {
  let createdId;

  it('POST /tasks — creates a task', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Write integration tests' });
    expect(res.statusCode).toBe(201);
    expect(res.body.title).toBe('Write integration tests');
    expect(res.body.completed).toBe(false);
    createdId = res.body.id;
  });

  it('GET /tasks — returns task list', async () => {
    const res = await request(app).get('/tasks');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET /tasks — filter shows only tasks matching title', async () => {
  await request(app).post('/tasks').send({ title: 'unique-marker-xyz' });
  const res = await request(app).get('/tasks');
  const match = res.body.find(t => t.title === 'unique-marker-xyz');
  expect(match).toBeDefined();
  });

  it('PATCH /tasks/:id — marks a task completed', async () => {
    const res = await request(app)
      .patch(`/tasks/${createdId}`)
      .send({ completed: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.completed).toBe(true);
  });

  it('DELETE /tasks/:id — removes a task', async () => {
    const res = await request(app).delete(`/tasks/${createdId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('deleted');
  });

  it('POST /tasks — 400 when title missing', async () => {
    const res = await request(app).post('/tasks').send({});
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /tasks/:id — 404 for non-existent task', async () => {
    const res = await request(app)
      .patch('/tasks/999999')
      .send({ completed: true });
    expect(res.statusCode).toBe(404);
  });
});
