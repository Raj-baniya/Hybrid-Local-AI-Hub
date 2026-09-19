import os

ROOT = "e:/Hybrid Local AI Hub"

def read(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as f:
        return f.read()

def write(path, content):
    with open(os.path.join(ROOT, path), "w", encoding="utf-8") as f:
        f.write(content)

c = read("ui/schema/graphSchema.ts")

missing_schemas = """export const NotifyDesktopConfigSchema = z.object({
  type: z.literal('NotifyDesktopNode'),
  title: z.string().default(''),
  body: z.string().default(''),
});

export const NotifyWebhookConfigSchema = z.object({
  type: z.literal('NotifyWebhookNode'),
  url: z.string().default(''),
  payload: z.string().default(''),
});

export const ClipboardTriggerConfigSchema = z.object({
  type: z.literal('ClipboardTriggerNode'),
  _dummy: z.boolean().default(false),
});

export const CsvReaderConfigSchema = z.object({
  type: z.literal('CsvReaderNode'),
  filePath: z.string().default(''),
  hasHeaderRow: z.boolean().default(true),
});

export const DelayConfigSchema = z.object({
  type: z.literal('DelayNode'),
  durationSeconds: z.number().int().nonnegative().default(5),
});

export const TemplateFormatterConfigSchema = z.object({
  type: z.literal('TemplateFormatterNode'),
  template: z.string().default(''),
});

export const MergeConfigSchema = z.object({
  type: z.literal('MergeNode'),
  _dummy: z.boolean().default(false),
});

export const AiPlanConfigSchema = z.object({"""

c = c.replace("export const AiPlanConfigSchema = z.object({", missing_schemas)

missing_types = """  NotifyDesktopConfigSchema,
  NotifyWebhookConfigSchema,
  ClipboardTriggerConfigSchema,
  CsvReaderConfigSchema,
  DelayConfigSchema,
  TemplateFormatterConfigSchema,
  MergeConfigSchema,
]);"""

c = c.replace("]);", missing_types)

write("ui/schema/graphSchema.ts", c)
print("Updated graphSchema.ts")
