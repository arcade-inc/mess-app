MyEdSpace
Assignment
Objective
Build a small web application that mocks the MES core user journey:

Parent purchases → Student onboards → Student accesses the LMS

The goal of this exercise is not to build a production system, but to demonstrate how you design and implement a simplified full-stack product flow.

At MES we strongly believe that AI should amplify engineers, not replace engineering thinking. We expect engineers to use AI tools to accelerate development, while remaining fully responsible for architecture, code quality, and technical decisions.

We are particularly interested in:

how you structure the systems

the technical decisions you make

how you balance speed and pragmatism

how you leverage AI tools during development

Exercise Description
Build a small web application where:

A parent purchases access for a student

The student completes onboarding

The student accesses a simple LMS

The application should support the core journey end-to-end.

Functional Requirements
1. Parent Purchase Flow
Parent lands on a product page

Parent selects a course

Parent completes a mock checkout (no real payment integration required)

After purchase, the system generates a student access path (e.g. invitation link)

2. Student Onboarding
Student accesses onboarding via the invitation or purchase outcome

Student completes a basic onboarding form

Student activates their account (e.g. sets a password, no real auth system required)

On completion, the student can access the platform

3. LMS Access
Only authenticated students can access the LMS

LMS contains a simple dashboard

LMS shows a list of lessons

Students can get access to a lesson

Technical Guidelines
At MES we primarily use:

React for frontend applications

Java and Node.js for backend services

For this exercise, we expect you to build the application using technologies aligned with this stack.

We understand that you may not have extensive experience with these specific technologies. We will evaluate your submission primarily on:

architecture and system design

clarity of implementation

product flow

engineering judgment

Minor imperfections related to unfamiliarity with the stack will not be penalised if the overall solution demonstrates strong engineering thinking.

AI Usage
We strongly encourage you to use AI coding tools during the exercise.

At MES we are currently standardising around Claude / Claude Code, but you are free to use the tools you are most comfortable with.

What matters to us is how you leverage AI effectively while remaining in control of the system design and implementation.

If you prefer not to use AI-assisted development, this exercise may not be a good reflection of how we work.

Provided Materials
To avoid spending time learning the MES domain, you can use the following sample courses.

These represent a simplified version of the types of courses available on MyEdSpace.

Each course has the following basic attributes:

subject

year

price

Example Courses
Maths

subject: Maths

year: Year 5 → 13

price: £199

English

subject: English

year: Year 5 → 13

price: £199

Science

subject: Science

year: Year 5 → 11

price: £199

Time Expectation
Please do not spend more than 3–4 hours on this exercise.

We value clarity and pragmatism over completeness.

Deliverables
Please submit:

1. Source Code
The complete source code for a working application implementing the core flow.

You can share your solution in one of the following ways:

as a public GitHub repository, or

as a private GitHub repository shared with the following GitHub users:

leopro

azamzamy

ser-within-mes

Josephaberry54

2. Dockerised Setup
The application should be runnable locally using Docker.

Please provide a docker-compose setup that allows the application to be started with a single command:

docker compose up

All required services should start through Docker Compose.

3. README
Include a short README covering:

architecture overview

key technical decisions

how you used AI tools during development, and attach any artefacts produced (e.g. plans, generated code snippets) where applicable




