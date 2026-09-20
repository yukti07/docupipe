## 1. Next.js 16 + React 19 + TypeScript with App Router

### Decision / Technology
**Next.js 16 + React 19 + TypeScript with App Router**

### Alternatives available
React + Vite, Angular, separate frontend and backend applications

### Why we chose it
We can keep the **UI and lightweight backend APIs in the same application**. TypeScript allows the UI and API to share types, reducing mistakes. Next.js also fits well with Vercel and lets the team move quickly with one web codebase.

### What we give up / trade-off
We accept Next.js/Vercel conventions and constraints. For very large systems, separating the frontend and backend completely can offer more independent scaling and deployment control.

---

## 2. Split processing into two workers: Schema Detector and Data Processor

### Decision / Technology
**Split processing into two workers: Schema Detector and Data Processor**

### Alternatives available
One worker that detects the schema and immediately converts the entire document

### Why we chose it
We intentionally separate **understanding the document** from **processing the full document**. The Schema Detector performs the relatively lightweight job of identifying the structure first. We then show that schema to the user and allow them to edit/approve it. Only after approval does the Data Processor run against the complete file. This keeps the workflow flexible and avoids doing full processing before we know what output the user actually wants.

### What we give up / trade-off
There are now two processing stages instead of one, which means more orchestration, states and Pub/Sub events. We also have to persist the schema between the two stages.

---

## 3. Cloud SQL — PostgreSQL

### Decision / Technology
**Cloud SQL — PostgreSQL**

### Alternatives available
Firestore, DynamoDB, AWS RDS, Supabase, Neon, self-managed PostgreSQL

### Why we chose it
Our data has clear relationships: **request → files → schemas → processing runs → results**. PostgreSQL handles these relationships, transactions and JSON data well. Cloud SQL gives us managed PostgreSQL without running the database ourselves.

### What we give up / trade-off
It does not scale to zero like Cloud Run, so there is some fixed cost. We also become more dependent on GCP.

---

## 4. Cloud Run

### Decision / Technology
**Cloud Run**

### Alternatives available
AWS ECS + Fargate, Kubernetes/GKE, VMs, Lambda/Cloud Functions

### Why we chose it
The **Schema Detector** and **Data Processor** are stateless, containerized workloads with bursty demand. Cloud Run is a good fit because it runs arbitrary Docker containers, autos-scales based on traffic, and can scale to zero when idle. This minimizes operational overhead for the POC.

### What we give up / trade-off
Less infrastructure control than Kubernetes or VMs. Cold starts are possible. AWS ECS/Fargate may be a better fit for companies already heavily invested in AWS.

---

## 5. Google Pub/Sub

### Decision / Technology
**Google Pub/Sub**

### Alternatives available
AWS SQS/SNS, Kafka, RabbitMQ, database-backed queues

### Why we chose it
It lets the web application and processing workers work **independently**. Uploading a file does not make the user wait for schema detection or conversion to finish. Pub/Sub simply sends a message to start the Cloud Run worker. It integrates well with the GCS bucket listener and the Cloud Run.

### What we give up / trade-off
Messages can be delivered more than once, so workers must be **idempotent** and safely handle duplicate messages. It also adds another piece of infrastructure.

---

## 6. Google Cloud Storage — GCS

### Decision / Technology
**Google Cloud Storage — GCS**

### Alternatives available
Amazon S3, Azure Blob Storage, storing files in PostgreSQL, local disk

### Why we chose it
PDFs, Excel files and images can be large. THe browser can upload directly to GCS using a signed URL, so large files do not have to pass through our Next.js server. Why to send the file to server when it is actually needed only by the workers.

### What we give up / trade-off
The database and files now live in two different systems, so we need to keep their references in sync. It also creates some GCP dependency and possible data-transfer latencies.

---

## 7. The file is the main processing unit, not the overall request

### Decision / Technology
**The file is the main processing unit, not the overall request**

### Alternatives available
Treat the whole upload/request as one large processing job

### Why we chose it
One request may contain a PDF, CSV, Excel and image, all with different structures. Processing each **file independently** lets every file have its own schema, status, errors and result. The request simply groups them together.

### What we give up / trade-off
Request-level status becomes more complex. Instead of simply saying “success” or “failure”, we may need to show “8 files completed, 1 failed, 1 still processing.”

---

## 8. Each Excel worksheet becomes an independent logical file, while only one XLSX is stored

### Decision / Technology
**Each Excel worksheet becomes an independent logical file, while only one XLSX is stored**

### Alternatives available
Treat the whole workbook as one dataset; physically split and store every sheet as a separate file

### Why we chose it
Different Excel sheets often represent completely different data—for example **Customers, Orders and Payments**. We keep the original workbook once in GCS, but internally treat every worksheet like a separate file. This means the rest of our pipeline can process each sheet normally.

### What we give up / trade-off
We need extra logic to map a logical worksheet back to the original Excel file. A workbook with many sheets also creates more items for the user to review.

---

## 9. Keep results separate by default; merging tables is an explicit action

### Decision / Technology
**Keep results separate by default; merging tables is an explicit action**

### Alternatives available
Automatically combine similar files/tables into one dataset

### Why we chose it
We do not want the system to silently combine data just because two tables look similar. First we preserve each result independently. The user can then explicitly merge **compatible tables** when they know the data represents the same thing.

### What we give up / trade-off
The user sometimes has to perform an extra merge step. Two tables that are conceptually the same but use slightly different column names may require mapping before they can be merged.

---

## 10. Support partial success instead of failing the entire request

### Decision / Technology
**Support partial success instead of failing the entire request**

### Alternatives available
All-or-nothing processing: if one file fails, the whole request fails

### Why we chose it
Real uploads are messy. One corrupted PDF or one bad Excel sheet should not destroy the successful work from the other files. We show status **per file / worksheet**, allow successful results to remain available, and let failed items be retried independently.

### What we give up / trade-off
The UI and backend state are more complicated because a request can be partly successful and partly failed. We need to communicate these mixed states clearly to the user.

---

## 11. Use Gemini instead of building our own OCR/document-understanding engine

### Decision / Technology
**Use Gemini instead of building our own OCR/document-understanding engine**

### Alternatives available
Build OCR ourselves using Tesseract/OpenCV, custom document-layout models, or train our own extraction models

### Why we chose it
**Time-to-market was the main reason.** Building reliable OCR plus table detection, layout understanding and semantic extraction is a large engineering problem on its own. Gemini lets us support PDFs, images and semi-structured documents much faster, allowing us to focus on the actual product: schema detection, user review and structured conversion.

### What we give up / trade-off
We depend on an external model provider, so there are API costs, rate limits and some variability in model output. We also have less control than we would with a fully custom document-understanding stack.

---
