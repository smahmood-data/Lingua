# Lingua Hackathon Prototype Roadmap

Lingua's hackathon prototype runs on one laptop. One person speaks Urdu and hears English; the other speaks English and hears Urdu. The interface shows bilingual subtitles and may produce a short summary when the conversation ends.

Third-party call integration, authentication, persistence, and a database are outside the prototype scope.

## Definition of done

- Urdu speech produces understandable English audio.
- English speech produces understandable Urdu audio.
- A clear control switches the active translation direction.
- The UI shows original and translated transcript turns.
- Microphone, network, and model failures are recoverable.
- The API key remains server-side.
- Pull requests pass CI before they are merged.
- The summary is included only if two-way translation is already reliable.

## Ordered issues

| Order | Issue | Story points | Dependencies |
| --- | --- | ---: | --- |
| 1 | [#1 Set up secure Gemini backend and shared types](https://github.com/smahmood-data/Lingua/issues/1) | 2 | None |
| 2 | [#2 Translate spoken Urdu into English audio](https://github.com/smahmood-data/Lingua/issues/2) | 5 | #1 |
| 3 | [#3 Translate spoken English into Urdu audio](https://github.com/smahmood-data/Lingua/issues/3) | 5 | #1, #2 |
| 4 | [#4 Build the interpreter UI and bilingual subtitles](https://github.com/smahmood-data/Lingua/issues/4) | 3 | #2, #3 |
| 5 | [#5 Generate an end-of-conversation summary](https://github.com/smahmood-data/Lingua/issues/5) | 3 | #1, #2, #3 |
| 6 | [#6 Add automated tests and GitHub Actions CI](https://github.com/smahmood-data/Lingua/issues/6) | 2 | #1; feature tests land with their features |
| 7 | [#7 Prepare the deployed demo and submission](https://github.com/smahmood-data/Lingua/issues/7) | 2 | #2, #3, #4, #6; #5 only if stable |

Issues are intentionally unassigned until the team agrees on ownership. Use one branch and pull request per issue, and include `Closes #<number>` in the pull request description.

## Recommended parallel work

- Start #1 first because it defines the secure server boundary and shared contracts.
- Once the contracts are agreed, one contributor can build #2 while another builds #4 against mocks.
- Build #3 by reusing #2 rather than creating a second audio architecture.
- Set up #6 early enough that feature pull requests receive checks.
- Treat #5 as optional. Cut it before weakening #2 or #3.
- Use #7 only for validation, deployment, documentation, and rehearsal—not new features.

## Demo fixture

Use a fixed conversation that contains concrete details:

> Your appointment is September 12 at 3:30 PM at the Queens location. Please arrive at 3:15 PM and bring your insurance card and photo ID.

The Urdu-speaking participant acknowledges the details and asks whether bloodwork is required. The English-speaking participant confirms it must be completed before the appointment.

If #5 is implemented, the expected summary contains:

- Appointment: September 12 at 3:30 PM
- Arrival: 3:15 PM
- Location: Queens location
- Documents: insurance card and photo ID
- Next step: complete bloodwork before the appointment

Do not hard-code these values into production components. They are a fixture for UI development, tests, and rehearsal.
