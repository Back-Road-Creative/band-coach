# Formative pilot protocol

This is a small, informal study to find out whether Band Coach actually works for a real learner
— not a controlled trial, and not proof that it improves anyone's playing. It exists to surface
confusing feedback, dead ends, and places the app disagrees with a human ear, early enough to fix
them. Treat every result here as **formative evidence, not proof of efficacy.**

## Who

6-10 participants, spread across:

- A **MIDI/keys path**: a participant with a MIDI keyboard (or willing to borrow one), so the
  detector's most reliable input is represented.
- A **real-microphone path**: at least a few participants on a real acoustic or electric
  instrument through a microphone, since that is the harder, noisier, more common case and the one
  this app has to be honest about when it fails.
- A **drum-kit path**: one participant with an electronic kit connected over MIDI, and one using
  the computer keys only (no kit on hand), so the newest trainer is checked against both real
  hardware and the always-available fallback.

Mixed skill levels (rank beginner through a few months in) — Band Coach's target learner is not
someone who already knows what "in tune" sounds like.

## Consent

Before any session: plain-language consent for anything captured locally (audio recordings,
screen recordings, notes). State clearly that nothing leaves their machine unless they explicitly
choose to share a file, and that they can stop or withdraw at any point, no explanation needed.

## Sessions

Several short sessions per participant, not one long one — habits and app usability both show up
differently on repeat use than on a first impression:

1. **Baseline check**: before touching the app, ask the participant to play something simple
   (a scale, a known phrase) so there's a reference for "how they actually play" independent of
   what the app reports.
2. **First session**: unboxing — can they get the app listening to them (mic or MIDI) and start a
   lesson without help? Note every point they got stuck, not just whether they eventually
   succeeded.
3. **A taught passage**: a short phrase the app has walked them through, so its feedback on
   something it has "seen" can be checked.
4. **An unfamiliar equivalent phrase**: a phrase of similar difficulty the app has *not* taught
   them, to see whether whatever they learned transfers, or whether they only got better at the
   one exercise.
5. **Next-day check-in**: a short session the following day — does the earlier feedback still
   make sense to them, does yesterday's mistake still happen?
6. **~One-week check-in**: a short session about a week later, same idea, at longer range —
   retention rather than the previous day's short-term memory.

## What to measure, each session

- **Completion without help**: could they get through the intended task (set up input, start a
  lesson, read the result) without a facilitator stepping in?
- **Feedback understood**: after the app tells them something ("that was sharp," "good timing"),
  can they say back in their own words what it meant and what to try next?
- **Repeated mistakes**: does the same error keep recurring across a session, or across sessions,
  despite the app flagging it each time? A pattern here is a coaching-strategy gap, not just a
  playing gap.
- **Independent accuracy at the declared tempo**: have someone who is not the app (a teacher, or
  the facilitator's own ear) separately judge pitch and timing accuracy at whatever tempo the
  participant claims — a sanity check on the app's own report.
- **Delayed retention**: compare the next-day and one-week check-ins against the first session —
  did the improvement stick, or evaporate?
- **Transfer**: does performance on the unfamiliar phrase (step 4) show any of the same
  improvement as the taught phrase, or is it isolated to exactly what was drilled?
- **App-vs-human disagreement**: every time the app's judgement (in tune / out of tune, on time /
  late) and an independent human ear disagree, log it — what was played, what the app said, what
  the human said. This is the single most direct signal on whether the detector itself is
  trustworthy.

## Recording results

One short write-up per participant: what they were trying to do, where they got stuck, direct
quotes where useful, and every app-vs-human disagreement logged verbatim. Aggregate only after
individual write-ups exist — a summary number this early implies more rigor than six to ten
informal sessions can support.

## What this is not

This is not a randomized trial, not powered for statistical significance, and not evidence that
Band Coach improves musical outcomes over any other method. It is a check for whether the app is
usable, honest about what it heard, and not actively teaching the wrong thing. Any claim about
efficacy needs a real study; this pilot's job is to make sure the app is ready to be studied.
