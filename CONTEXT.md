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

**普通发送**:
One ordinary Companion composer submission, containing optional text and zero or more selected images. The alpha Session controller owns its transient pending echo while the Host conversation projection remains authoritative.

**消息单元**:
One speaker's contribution presented as a single conversational unit. It may contain text, a 图片组, or both, while retaining one speaker identity and alignment.
_Avoid_: 时间线项, 图片行

**图片组**:
The ordered images belonging to one 消息单元. User and Companion image groups share the same viewing semantics even when their conversational alignment differs.
_Avoid_: 独立图片消息, 附件行

**普通展示**:
The bounded in-conversation view of a 图片组, optimized for scanning the transcript rather than inspecting every original-image detail.
_Avoid_: 缩略图预览, 原图

**原图预览**:
The focused view opened from an image in a 图片组 or from a selected draft image, where the complete image is available for inspection outside the transcript flow.
_Avoid_: 普通展示, 图片详情页

**此刻状态**:
The Companion's current bounded descriptive state, represented by one fixed state key and an optional short note. It has no degree, rank, or intensity dimension.
_Avoid_: 心情强度, 情绪等级
