-- KSR 导演顾问：每个分镜补充「设计理由」与「转场」字段
ALTER TABLE storyboards ADD COLUMN rationale TEXT;
ALTER TABLE storyboards ADD COLUMN transition TEXT;
