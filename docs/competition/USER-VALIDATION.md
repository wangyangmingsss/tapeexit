# User Validation Record Template

No participants have been recruited or contacted. This template is for later permissioned sessions.

`USER-SESSION.example.json` is an intentionally invalid blank record, not a participant.
Create a private JSON array of actual consented sessions and run `npm run report:users -- <sessions.json>`.
Use pseudonymous participant/session/scenario IDs. `environment` is `isolation-demo`, `local-fork` or `mainnet`;
`method` is `tapeexit`, `explorer` or `official-local`. Record measured seconds, assistance/errors and whether
the participant recognized the environment. Record source commit and manifest digest for every method so comparisons
remain bound to the release under evaluation. Mainnet claims require an actual transaction hash and later verification.

The summarizer rejects unconsented or duplicate sessions, counts unique participants separately, groups by version,
scenario and environment, and excludes quotations without separate publication consent. Do not commit participant records.
With no input it explicitly reports `NO_USER_EVIDENCE`. Self-reported records do not authenticate consent or observations.

## Session

Record participant code, consent to participate, separate consent for quotation/publication, date, environment, source commit and task starting condition. Avoid collecting wallet secrets, private keys or unnecessary personal information.

Use a local simulation or a participant-controlled, explicitly authorized test position. Do not request mainnet transactions as an unannounced usability exercise.

## Task

Give the participant a saved entry, a known position ID and an accurately described controlled frontend outage. Ask them to determine ownership, choose 50%, inspect the actual target and recipient, complete the approved environment's task, and save the recovery information.

Do not teach each step first and then count the result as unassisted completion.

| Observation | Record |
| --- | --- |
| Environment and exact fault | Not yet recorded |
| Independent completion | Not yet tested |
| Time to correct review screen | Not yet measured |
| Errors or wrong assumptions | Not yet observed |
| Assistance requested/provided | Not yet recorded |
| Recognition of simulation/mainnet and confirmation level | Not yet tested |
| Ability to reopen recovery entry | Not yet tested |
| Direct quote and publication consent | None |

## Comparison

Compare the same task, network access and outage against a preserved official/IPFS frontend, a local open-source frontend and explorer calls where feasible. Record preparation time and failures for every option; do not selectively disable only competitors' dependencies.

## Protocol Feedback

Use the same consent and attribution rules for maintainers. Distinguish a conversation, a pilot proposal, an agreed pilot, a paid intention and received revenue. All remain unverified until real evidence exists.
