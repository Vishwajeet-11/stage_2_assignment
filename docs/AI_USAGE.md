I used Cursor's coding agent, Grok, and I reviewed the diff after every code update. The prompts I kept were: "analyze the Senior_Backend_Engineer_Stage2.docx.pdf and docs/Senior_Backend_Engineer_Stage1_Answers.pdf is for the context," "plan it out," and "The interviewer will validate and check this code, the whole codebase, with an AI itself... what do you think the AI will tell, as in critic?" After that review I sent "can we fix these issues. the ones that are easily fixable?" and then named the fixes to apply.

The agent got the outline right. It kept Express, Zod, BullMQ, and Prisma, verified HMAC-SHA256 with a timing-safe compare, and kept 401, 403, and 404 distinct on the status route. The two-command startup and the two-tenant seed were the right shape for the timebox.

The problems showed up in the diffs, not in the summary. The first webhook handler set the Redis claim before BullMQ accepted the job. I rejected that. A crash in that gap would return 200 on every retry and never run the worker. The claim is written only after queue.add resolves. BullMQ's job id still stops a second enqueue.

The same handler returned 200 for an investor id that was not in the database. The worker then failed permanently and left the Redis key in place, so the provider would not retry and the status would never change. I made that a 404 before enqueue, with no claim written.

Signature verification ran only after express.json had parsed the body. A malformed body with a bad signature came back as 400. I moved the webhook route onto the raw bytes so the signature is checked first and a bad signature stays 401.

last_event_at was processed_at. A late older event moved that timestamp while kyc_status stayed on the newer event. I changed the read to return the provider timestamp of the newest stored payload, which is the event that decided the status.

The agent also renamed the table to webhook_events. The brief said to extend the starter schema, not rename it. I put the model name back and kept only the investor_id column the status route needs.

I did not take every suggestion. The agent's first literal reading deleted the Redis key and stopped there, which reopened duplicates. I kept the WebhookEvent lookup on a Redis miss, because that is what makes the required delete safe.
