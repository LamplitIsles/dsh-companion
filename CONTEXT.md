# Companion Conversation Continuity

This context describes how Companion keeps a private conversation coherent as its model-visible history grows, while preserving a calm, one-to-one chat experience.

## Language

**对话容量**:
The approximate share of the current model context available to continue this Companion conversation. It is a user-facing reference, not a promise that the next request will be accepted.
_Avoid_: Token 余额, context window 占用

**整理记忆**:
The user-facing name for automatic compaction: older model-visible conversation is condensed so the Companion can continue naturally. It does not delete the human-readable transcript.
_Avoid_: 删除聊天记录, 压缩聊天

**连续性摘要**:
The private checkpoint produced by 整理记忆 for the next model request. It is model-only and never rendered to the user.
_Avoid_: 对话总结, 整理结果

**整理记录**:
The small, non-expandable timeline notice that a 整理记忆 completed. It reveals no 连续性摘要 content.
_Avoid_: 压缩摘要卡片

**发送批次**:
One ordinary Companion composer submission, containing optional text and zero or more selected images while the Host write is being confirmed.
It is transient client presentation; the Host conversation projection remains authoritative.
