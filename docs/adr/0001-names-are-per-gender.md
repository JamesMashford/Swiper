# Names are per gender, and a match needs the same Name

A Name is a given name for one gender, so Charlie as a boy's name and Charlie as a girl's name are two Names. A Match needs both partners to like the same Name, and a partner who has swiped one gender version is not offered the other. We chose this over one row per name with a gender share because it matches the existing schema (`unique (name, gender)`) and keeps matching and the shortlist simple; the share design added a threshold to tune and a data migration for little gain.

## Consequences

- If a nursery's gender filter allows more than one gender, two partners can swipe different versions of the same text and miss a match. This is accepted.
- Accent differences do not create separate Names (Søren and Soren are one). Respellings such as Sofia and Sophia are separate Names.
