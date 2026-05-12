---
title: "The Containerized SDLC — Local Lab"
tags: [docker, devops, sdlc, testcontainers, kubernetes, ci-cd]
cssclasses: [lab-guide]
aliases: [containerized-sdlc-lab]
created: 2026-05-12
difficulty: intermediate
duration: "~90 min"
---

# 🐳 The Containerized SDLC — Local Lab

> **Goal:** Build a real Node.js API, then apply containers at every stage of the software development lifecycle — local dev, integration testing, CI/CD, and Kubernetes deployment. No cloud. No labspace VM. All local.

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Docker Engine | ≥ 26 | `docker version` |
| Docker Compose | ≥ 2.24 (plugin) | `docker compose version` |
| Node.js | ≥ 20 | `node --version` |
| npm | ≥ 10 | `npm --version` |
| kubectl | any recent | `kubectl version --client` |
| k3d | ≥ 5 | `k3d version` (installed in Module 6) |
| VS Code | any | — |

> [!NOTE] Ubuntu 26 note
> You already have Docker Engine + Portainer running. Verify Compose plugin is present with `docker compose version`. If missing: `sudo apt install docker-compose-plugin`.

---

## Lab Structure

```
taskflow-sdlc-lab/
├── project/
│   ├── src/index.js          ← The TaskFlow API
│   ├── tests/
│   │   └── tasks.integration.test.js
│   ├── Dockerfile
│   ├── .dockerignore
│   └── package.json
├── compose.yaml              ← Module 2: DB + pgAdmin
├── compose.dev.yaml          ← Module 3: Full dev stack + Watch
├── .github/
│   └── workflows/ci-cd.yaml  ← Module 5: CI/CD pipeline
├── k8s/
│   ├── deployment.yaml       ← Module 6
│   ├── service.yaml
│   └── postgres.yaml
└── scripts/
    └── create-cluster.sh
```

---

## Module 1 — Meet the App

### What is TaskFlow?

TaskFlow is a minimal REST API for task management backed by PostgreSQL. It is the application you will carry through the entire SDLC — the same source code and the same container image will travel from your laptop all the way to Kubernetes.

### Explore the source

Open `project/src/index.js` in VS Code. The API exposes five endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check — returns `{ status: "ok" }` |
| `GET` | `/tasks` | List all tasks |
| `POST` | `/tasks` | Create a task `{ "title": "..." }` |
| `PATCH` | `/tasks/:id` | Toggle `completed` |
| `DELETE` | `/tasks/:id` | Remove a task |

The app reads database connection details from environment variables (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`) with sane defaults for local development.

### Key insight

> [!INFO] The SDLC Journey
> The same `index.js` runs in every environment in this lab. What changes is the *infrastructure* around it — and containers make that infrastructure portable and reproducible.

---

## Module 2 — Local Dev with Docker Compose

### Goal

Provision a PostgreSQL database and pgAdmin (a web-based DB visualizer) using a `compose.yaml`, without running the app itself yet.

### 2.1 — Examine compose.yaml

Open `compose.yaml`. Notice:

- `db` uses `postgres:16-alpine` and exposes port `5432`
- `pgadmin` depends on `db` with a `condition: service_healthy`
- A named volume `db_data` persists data across restarts

The `db` service has a **healthcheck** that runs `pg_isready`. The `depends_on` condition ensures pgAdmin only starts *after* Postgres is truly ready — not just started.

### 2.2 — Start the stack

Open a terminal in the lab root:

```bash
docker compose up -d
```

Verify both containers are running:

```bash
docker compose ps
```

Expected output:

```
NAME                SERVICE    STATUS         PORTS
...-db-1            db         running        0.0.0.0:5432->5432/tcp
...-pgadmin-1       pgadmin    running        0.0.0.0:5050->80/tcp
```

### 2.3 — Explore pgAdmin

1. Open **http://localhost:5050** in your browser
2. Log in: email `admin@local.dev`, password `admin`
3. Click **Add New Server**
   - **Name:** `taskflow`
   - **Host:** `db` *(the Docker service name — Compose creates an internal DNS entry)*
   - **Port:** `5432`
   - **Username:** `postgres`
   - **Password:** `postgres`
4. Browse to **Databases → taskflow**

> [!TIP] Service discovery in Docker networks
> Within a Compose network, services resolve each other by service name (`db`, `app`, etc.). This is why you connect to `db`, not `localhost`. The app container will do the same.

### 2.4 — Tear down

```bash
docker compose down
```

The `db_data` volume is preserved. To wipe it too: `docker compose down -v`.

---

## Module 3 — Containerizing the Dev Environment

### Goal

Add the TaskFlow API to the stack and enable **hot-reloading** with Compose Watch so code changes appear instantly without rebuilding.

### 3.1 — Examine the Dockerfile

Open `project/Dockerfile`. It uses **multi-stage builds**:

| Stage | Purpose |
|---|---|
| `base` | Shared base — sets WORKDIR, copies package files |
| `deps` | Production deps only (`npm ci --omit=dev`) |
| `dev-deps` | All deps including `nodemon` for development |
| `production` | Minimal final image — non-root user, no dev tools |

> [!INFO] Why multi-stage?
> The `production` image is smaller and more secure — it doesn't contain test or build tools. The `dev-deps` stage is only used by `compose.dev.yaml`, never shipped.

### 3.2 — Examine compose.dev.yaml

Open `compose.dev.yaml` and find the `app` service:

```yaml
app:
  build:
    context: ./project
    target: dev-deps       # ← uses the dev stage, includes nodemon
  command: ["npx", "nodemon", "src/index.js"]
  develop:
    watch:
      - action: sync
        path: ./project/src
        target: /app/src
      - action: rebuild
        path: ./project/package.json
```

**Two watch rules:**

- `sync` — when a `.js` file in `src/` changes, Docker copies the new file *directly into the running container*. No restart. nodemon detects the change and restarts the Node process.
- `rebuild` — when `package.json` changes (new dependency added), Docker does a full image rebuild. This is necessary because node_modules lives inside the container.

### 3.3 — Start the full dev stack

```bash
docker compose -f compose.dev.yaml up --watch
```

You should see the API start:

```
app-1  | TaskFlow API listening on port 3000
```

### 3.4 — Test the API

Open a **second terminal** and run:

```bash
# Create a task
curl -s -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Learn Compose Watch"}' | jq .

# List tasks
curl -s http://localhost:3000/tasks | jq .
```

> [!TIP] jq not installed?
> `sudo apt install jq` — or just omit `| jq .` to see raw JSON.

### 3.5 — Test hot-reload

In VS Code, open `project/src/index.js`. Find the `/health` route:

```js
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

Add a new field, for example:

```js
res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
```

Save the file. In the first terminal you should see:

```
app-1  | [nodemon] restarting due to changes...
app-1  | TaskFlow API listening on port 3000
```

Then verify:

```bash
curl -s http://localhost:3000/health | jq .
```

The new `version` field appears — **without a rebuild or restart of Docker Compose**.

### 3.6 — Tear down

```bash
# Ctrl+C to stop the watch session, then:
docker compose -f compose.dev.yaml down
```

---

## Module 4 — Integration Testing with Testcontainers

### Goal

Write self-contained integration tests that spin up a *real* PostgreSQL container, run the tests against it, and tear it down — all automatically. No mocking. No test database to manage.

### 4.1 — Install dependencies

```bash
cd project
npm install
```

This installs `testcontainers`, `jest`, and `supertest` (listed in `devDependencies`).

### 4.2 — Examine the test file

Open `tests/tasks.integration.test.js`. Walk through the structure:

**`beforeAll` — start the container:**

```js
container = await new PostgreSqlContainer('postgres:16-alpine')
  .withDatabase('taskflow_test')
  .withUsername('testuser')
  .withPassword('testpassword')
  .start();
```

Testcontainers pulls (or reuses a cached) `postgres:16-alpine` image, starts it, maps a random host port, and waits until Postgres is ready to accept connections. This is real Postgres — not an in-memory substitute.

**Environment injection before app load:**

```js
process.env.DB_HOST = container.getHost();
process.env.DB_PORT = String(container.getMappedPort(5432));
// ...
jest.resetModules();
app = require('../src/index');
```

The test sets env vars *before* requiring the app module, so the app's `Pool` picks up the test database connection. `jest.resetModules()` ensures a fresh module instance for each test run.

**`afterAll` — stop the container:**

```js
await container.stop();
```

The Postgres container is stopped and removed automatically, regardless of whether the tests pass or fail.

### 4.3 — Run the tests

Make sure you are in the `project/` directory:

```bash
npm test
```

On the first run, Docker will pull `postgres:16-alpine` if not cached. You will see logs similar to:

```
  Starting container postgres:16-alpine...
  Container started: 8f3a1b9c2d...
  TaskFlow API listening on port 3000

  Tasks CRUD
    ✓ POST /tasks — creates a task (312 ms)
    ✓ GET /tasks — returns task list (45 ms)
    ✓ PATCH /tasks/:id — marks a task completed (38 ms)
    ✓ DELETE /tasks/:id — removes a task (41 ms)
    ✓ POST /tasks — 400 when title missing (12 ms)
    ✓ PATCH /tasks/:id — 404 for non-existent task (14 ms)

  GET /health
    ✓ returns 200 and status ok (8 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

> [!NOTE] Why is the first run slower?
> Docker pulls the Postgres image. Subsequent runs use the cached image and start in a few seconds.

### 4.4 — Write an additional test (optional)

Add this test case inside the `Tasks CRUD` block in the test file:

```js
it('GET /tasks — filter shows only tasks matching title', async () => {
  await request(app).post('/tasks').send({ title: 'unique-marker-xyz' });
  const res = await request(app).get('/tasks');
  const match = res.body.find(t => t.title === 'unique-marker-xyz');
  expect(match).toBeDefined();
});
```

Re-run `npm test` and watch the new test pass with a real database.

> [!INFO] The Testcontainers advantage
> Because every test run gets a *fresh container*, tests are isolated and reproducible. There is no shared state between runs and no test database drift. This is the same behavior you get in CI.

### 4.5 — Return to the lab root

```bash
cd ..
```

---

## Module 5 — Continuous Integration with GitHub Actions

### Goal

Build a pipeline that automatically runs the integration tests, builds the container image, and pushes it to Docker Hub on every push to `main`.

### 5.1 — Prerequisites for this module

- A **GitHub account** and the lab code pushed to a repository
- A **Docker Hub account** (free tier is fine)
- Two **GitHub repository secrets**:

| Secret name | Value |
|---|---|
| `DOCKERHUB_USERNAME` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | A Docker Hub access token (Settings → Security → New Access Token) |

To add secrets: GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**.

### 5.2 — Push your code

If you haven't already:

```bash
git init
git add .
git commit -m "feat: initial TaskFlow SDLC lab"
git remote add origin https://github.com/YOUR_USERNAME/taskflow-sdlc-lab.git
git push -u origin main
```

### 5.3 — Examine the workflow

Open `.github/workflows/ci-cd.yaml`. The pipeline has **three jobs**:

**Job 1 — `test`**

Runs on every push and every PR. It checks out code, installs Node 20, and runs `npm test`. Because Testcontainers is used, the GitHub-hosted runner has Docker available and the test spins up its own Postgres container — no external database needed.

**Job 2 — `build-and-push`**

Runs only on pushes to `main`, only after `test` passes (`needs: test`). It:

1. Sets up Docker Buildx (multi-platform builder)
2. Logs in to Docker Hub using your secrets
3. Extracts image tags (a `sha-` tag plus `latest`)
4. Builds the production image (`target` defaults to the last stage — `production`) and pushes it

**Job 3 — `deploy`**

A skeleton deploy step. For a real self-hosted runner deployment, see the note in the workflow file. For now, it prints the manifests that would be applied.

### 5.4 — Trigger the pipeline

Make a small code change, commit, and push:

```bash
# Example: add a comment to index.js
echo "// pipeline trigger $(date)" >> project/src/index.js
git add project/src/index.js
git commit -m "ci: trigger pipeline test"
git push
```

Go to your GitHub repository → **Actions** tab. You should see the workflow running.

### 5.5 — Verify the image on Docker Hub

After the `build-and-push` job completes, go to **hub.docker.com → your repositories**. You should see `taskflow-api` with a `latest` tag and a `sha-...` tag.

Pull and run it locally to verify:

```bash
docker run --rm \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_NAME=taskflow \
  -e DB_USER=postgres \
  -e DB_PASSWORD=postgres \
  -p 3001:3000 \
  YOUR_DOCKERHUB_USERNAME/taskflow-api:latest
```

> [!NOTE] host.docker.internal on Linux
> On Linux, `host.docker.internal` requires `--add-host=host.docker.internal:host-gateway` in the `docker run` command, or use the actual host IP. Make sure your local Postgres (from Module 2/3) is running.

---

## Module 6 — Deploying to Kubernetes

### Goal

Write Kubernetes manifests and deploy TaskFlow to a local **k3d** cluster (k3s in Docker). Configure the app to use the image built in Module 5.

### 6.1 — Install k3d

```bash
curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
k3d version
```

Or use the provided script:

```bash
bash scripts/create-cluster.sh
```

The script creates a `taskflow` cluster with 2 agent nodes and a load balancer mapping port `8080` on your host to port `80` in the cluster.

### 6.2 — Verify the cluster

```bash
kubectl get nodes
```

Expected:

```
NAME                     STATUS   ROLES                  AGE
k3d-taskflow-server-0    Ready    control-plane,master   30s
k3d-taskflow-agent-0     Ready    <none>                 25s
k3d-taskflow-agent-1     Ready    <none>                 25s
```

### 6.3 — Examine the manifests

Open `k8s/postgres.yaml`. It defines:

- A `Secret` holding database credentials
- A `PersistentVolumeClaim` for Postgres data
- A `Deployment` for Postgres
- A `ClusterIP` Service named `postgres-svc`

Open `k8s/deployment.yaml`. Notice:

- The `DB_HOST` env var is `postgres-svc` — the internal Kubernetes service name
- Credentials come from the `postgres-secret` Secret via `secretKeyRef`
- Both liveness and readiness probes hit `/health`
- Resource requests and limits are set (best practice)

Open `k8s/service.yaml`. The `taskflow-api-svc` is of type `LoadBalancer`. With k3d's load balancer, it becomes reachable on `http://localhost:8080`.

### 6.4 — Update the image reference

Edit `k8s/deployment.yaml` and replace the placeholder image:

```yaml
# Change this line:
image: taskflow-api:local
# To your Docker Hub image:
image: YOUR_DOCKERHUB_USERNAME/taskflow-api:latest
```

If you prefer to test with a locally-built image (without pushing to Docker Hub), import it into k3d:

```bash
cd project
docker build -t taskflow-api:local .
k3d image import taskflow-api:local -c taskflow
cd ..
```

Then keep `image: taskflow-api:local` and set `imagePullPolicy: Never` in `deployment.yaml`.

### 6.5 — Deploy

```bash
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

Watch the pods come up:

```bash
kubectl get pods --watch
```

Wait until all pods show `Running`:

```
NAME                            READY   STATUS    RESTARTS   AGE
postgres-...                    1/1     Running   0          20s
taskflow-api-...                1/1     Running   0          15s
taskflow-api-...                1/1     Running   0          15s
```

### 6.6 — Test the deployed API

```bash
curl -s http://localhost:8080/health | jq .
```

```json
{ "status": "ok", "timestamp": "2026-05-12T..." }
```

Create a task:

```bash
curl -s -X POST http://localhost:8080/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Deployed to Kubernetes!"}' | jq .
```

List tasks:

```bash
curl -s http://localhost:8080/tasks | jq .
```

### 6.7 — Automated rollout on push

The CI/CD workflow skeleton in Module 5 includes a `deploy` job that runs `sed` to update the image tag in `deployment.yaml` and then calls `kubectl apply`. To wire this up fully for your local cluster, you would register a **GitHub Actions self-hosted runner** on your workstation:

```bash
# From GitHub: Settings → Actions → Runners → New self-hosted runner
# Follow the Linux instructions provided by GitHub
# Change the deploy job's runs-on:
#   runs-on: self-hosted
```

When the runner is active, every push to `main` will: test → build → push to Docker Hub → apply the new image tag to your k3d cluster.

> [!TIP] Rolling update behaviour
> Kubernetes performs a rolling update by default. The old pods stay up until the new pods pass their readiness probes. Your API stays available throughout the deployment.

### 6.8 — Scale and inspect

```bash
# Scale to 3 replicas
kubectl scale deployment taskflow-api --replicas=3

# Inspect a pod's logs
kubectl logs -l app=taskflow-api --tail=20

# Describe the service
kubectl describe service taskflow-api-svc

# Port-forward to a specific pod (useful for debugging)
kubectl port-forward deployment/taskflow-api 3002:3000
```

### 6.9 — Tear down the cluster

```bash
k3d cluster delete taskflow
```

---

## Module 7 — The Containerized SDLC: A Recap

You have just containerized every stage of a real application's lifecycle:

| Stage | Tool | What containers gave you |
|---|---|---|
| **Local Dev** | Docker Compose + Compose Watch | Consistent DB environment; hot-reload without host dependencies |
| **Testing** | Testcontainers | Real Postgres in every test run; no test DB to manage; identical to CI |
| **CI/CD** | GitHub Actions | Tests run against real containers; image built once, tagged, pushed |
| **Deployment** | Kubernetes (k3d) | Same image from CI deployed to cluster; liveness/readiness probes; rolling updates |

### The portability principle

The Docker image built in Module 5 ran:

1. On the GitHub Actions runner
2. On your workstation via `docker run`
3. In a Kubernetes Pod

**The same bytes, three environments.** That's the core promise of containers in the SDLC.

---

## Troubleshooting

> [!QUESTION] `docker compose up` fails — port 5432 already in use
> Stop any local Postgres instance: `sudo systemctl stop postgresql`
> Or change the host port mapping in `compose.yaml`: `"5433:5432"`

> [!QUESTION] pgAdmin can't connect to the database
> The host must be `db` (the service name), not `localhost` or `127.0.0.1`. Compose services reach each other by name within the same network.

> [!QUESTION] `npm test` is very slow the first time
> Testcontainers is pulling the `postgres:16-alpine` image. Run `docker pull postgres:16-alpine` manually beforehand to cache it.

> [!QUESTION] Testcontainers throws `Cannot connect to Docker daemon`
> Your user must be in the `docker` group: `sudo usermod -aG docker $USER` then log out and back in. Or prefix with `sudo`.

> [!QUESTION] `kubectl get pods` — ImagePullBackOff
> Either the image name in `deployment.yaml` is wrong, or if using a local image with k3d, you need to import it: `k3d image import taskflow-api:local -c taskflow`.

> [!QUESTION] k3d load balancer port 8080 not responding
> Check the cluster is running: `k3d cluster list`. If it shows Stopped, start it: `k3d cluster start taskflow`.

---

## Quick Reference

```bash
# Module 2 — start DB + pgAdmin
docker compose up -d

# Module 3 — full dev stack with hot-reload
docker compose -f compose.dev.yaml up --watch

# Module 4 — run integration tests
cd project && npm test && cd ..

# Module 5 — push and trigger CI
git push origin main

# Module 6 — create cluster and deploy
bash scripts/create-cluster.sh
kubectl apply -f k8s/

# Module 6 — tear down cluster
k3d cluster delete taskflow

# Stop everything (Module 2/3)
docker compose down
docker compose -f compose.dev.yaml down -v
```
