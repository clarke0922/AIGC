---
name: minimax-h3-video-prompt
description: Rewrite short Chinese or English creative briefs into the official MiniMax H3 video-prompt format. Use for H3 text-to-video, first/last-frame generation, character or style references, multimodal reference generation, dialogue, audio guidance, and video editing; do not use for other video models.
---

# MiniMax H3 Video Prompt

Turn the user's requirements into one copy-ready MiniMax H3 prompt. Preserve the requested story, identity, dialogue, duration, aspect ratio, references, and audio intent. Fill only the production details needed to make the shot executable; do not add unrequested brands, characters, dialogue, visible writing, plot events, or reference roles.

## Route the task

- Use the base guide for T2VA, first-frame I2VA, first-and-last-frame FL2VA, or last-frame L2VA. Read [references/VIDEO_PROMPT_WRITING_GUIDE_base_en.md](references/VIDEO_PROMPT_WRITING_GUIDE_base_en.md) before writing.
- Use the full-reference guide when an image defines reusable identity/style/objects rather than a concrete keyframe, when video or audio is referenced, or when the user asks for Omni/reference generation, action transfer, continuation, or video editing. Read [references/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md](references/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) and the base guide sections it cites.
- Infer the mode from the stated role of each attachment, not merely its file type. An image used as the exact opening frame is base I2VA; an image used only for character identity is full-reference mode.
- Default to T2VA when no reference media or keyframe role is provided. Ask one concise question only when the missing distinction materially changes the format, such as whether an image is a first frame or an identity reference. FL2VA/L2VA requires the effective duration for its final-frame alignment; request it if it cannot be inferred safely.

## Shared invariants

- Write structural fields and scene description in English. Preserve the original language only inside dialogue/lyrics `<d>` blocks and for visible writing explicitly requested by the user.
- Preserve user-supplied dialogue word-for-word. Assign stable `(S1)`, `(S2)` IDs and write spoken content only as `<d>[Language] exact words</d>`.
- Never put dialogue in quotation marks. Use English double quotation marks only when the user explicitly wants words visibly present in the frame.
- Do not silently convert dialogue into captions or invent visible writing. When the user wants an unobstructed frame, express the desired visible background positively without repeating unwanted text concepts.
- Keep the first shot untimestamped. Number later shots sequentially and use strictly increasing `MM:SS.mmm` cut times within the duration.
- Make action, camera movement, framing, sound, and state transitions physically achievable in the requested duration. Prefer one coherent shot unless cuts add information or the user requests them.
- Put dialogue, singing, and shot-synchronous diegetic sound in the main description. Use `overall_soundscape` only for ambience, physical sounds, and non-verbal human sounds. Use `non_diegetic_music` only for audience-only score; write `N/A` when absent.

## Base-mode output

Follow the official alignment sentence exactly for I2VA, FL2VA, or L2VA. T2VA begins directly with these fields, in this order:

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

Anchor I2VA to the actual first frame, describe the observable path between both frames for FL2VA, and converge on the supplied last frame for L2VA. Do not merely restate the reference images.

## Full-reference output

Write all six sections in this exact order:

```text
subject_definitions:
...

summary:
...

retention_analysis:
...

detailed_description:
...

overall_soundscape:
...

non_diegetic_music:
...
```

- Number `<Subject N>`, `<Picture N>`, `<Video N>`, and `<Audio N>` independently and keep every label stable across all sections.
- Define visible reusable content as `<Subject N>`. Create standalone `<Picture N>` only for a concrete keyframe/composition anchor, `<Video N>` for a whole-video edit/continuation/temporal relationship, and `<Audio N>` only for enabled copied or referenced audio.
- Select task-type prefixes and retention markers only from the official guide. Do not infer audio reuse merely because a reference video contains audio.
- Make `detailed_description` explicit rather than a plot summary. For reference-generation tasks, normally target the official 350-500 English-word range; scale video-editing descriptions to source complexity.

## Deliverable

Return a single copy-ready prompt in a fenced `text` block. Precede it only with a short Chinese mode label such as `模式：T2VA` or `模式：全能参考（reference generation）`. Do not add rationale, parameter advice, alternate prompts, or a Chinese translation unless requested.

Before returning, silently verify mode, field order, reference-label consistency, timestamp coverage, dialogue tags/language, audio categorization, and preservation of every explicit user requirement.
