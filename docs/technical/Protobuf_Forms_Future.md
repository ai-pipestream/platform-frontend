# Protobuf Forms - Future Vision with Buf Plugin

## 1. Vision

Transform protobuf definitions into a **complete form generation system** where developers annotate proto files once and get automatic, production-ready forms everywhere - frontend, backend, and any language.

**Think of it as:** JSONForms for Protobufs - annotations in proto drive the entire form rendering pipeline.

## 2. The Buf Plugin Approach

### Why Buf Plugins?

Buf plugins are **code generators** that run during the proto compilation process. They can:
- Read proto definitions and custom options
- Generate code in any language
- Access full descriptor information
- Integrate seamlessly with existing buf workflows

**Key Insight:** By using custom proto options (annotations), you get:
- Single source of truth (proto files)
- Build-time code generation (zero runtime cost)
- Language-agnostic (works for Java, TypeScript, Go, etc.)
- Version controlled (schemas versioned with protos)

### Architecture

```mermaid
graph TD
    A[Proto files with annotations] --> B[buf generate]
    B --> C[protoc-gen-es: TypeScript types]
    B --> D[protoc-gen-jsonschema: JSON Schemas]
    B --> E[protoc-gen-java: Java code]

    C --> F[@ai-pipestream/grpc-stubs package]
    D --> F

    F --> G[Frontend: JSONForms renders forms]
    F --> H[Backend: Validation & defaults]
```

## 3. Custom Proto Annotations

### Defining Form Options

**File:** `proto/options/form_options.proto`

```protobuf
syntax = "proto3";

package ai.pipestream.forms;

import "google/protobuf/descriptor.proto";

// ============================================================================
// FIELD-LEVEL OPTIONS
// ============================================================================

extend google.protobuf.FieldOptions {
  // Widget type for rendering
  // Values: "text", "textarea", "select", "multiselect", "date", "datetime",
  //         "checkbox", "radio", "slider", "color", "file", "dynamic", etc.
  string ui_widget = 50001;

  // Display label (overrides auto-generated from field name)
  string ui_label = 50002;

  // Help text / description shown to user
  string ui_help = 50003;

  // Placeholder text for input fields
  string ui_placeholder = 50004;

  // Hide field from form completely
  bool ui_hidden = 50005;

  // Make field read-only (displayed but not editable)
  bool ui_readonly = 50006;

  // Display order (lower numbers shown first)
  int32 ui_order = 50007;

  // Validation regex pattern
  string ui_pattern = 50008;

  // Minimum value (for numeric fields)
  double ui_min = 50009;

  // Maximum value (for numeric fields)
  double ui_max = 50010;

  // Minimum length (for strings and arrays)
  int32 ui_min_length = 50011;

  // Maximum length (for strings and arrays)
  int32 ui_max_length = 50012;

  // Options for select/multiselect widgets (comma-separated)
  string ui_select_options = 50013;

  // For Any fields - how to resolve the concrete type
  // Values: "apicurio", "registry", "inline"
  string any_resolver = 50014;

  // Group/section name for organizing fields
  string ui_group = 50015;

  // Custom CSS class for styling
  string ui_class = 50016;

  // Step value for numeric inputs
  double ui_step = 50017;
}

// ============================================================================
// MESSAGE-LEVEL OPTIONS
// ============================================================================

extend google.protobuf.MessageOptions {
  // Form title (overrides message name)
  string form_title = 51001;

  // Form description/subtitle
  string form_description = 51002;

  // Layout mode: "vertical", "horizontal", "grid", "tabs"
  string form_layout = 51003;

  // Validation mode: "onChange", "onBlur", "onSubmit"
  string form_validation = 51004;

  // Icon for form (Material Design icon name)
  string form_icon = 51005;

  // Whether to show a submit button
  bool form_show_submit = 51006;

  // Submit button text
  string form_submit_text = 51007;
}
```

### Using Annotations in Proto Files

**Example:** Fully annotated PipeDoc

```protobuf
syntax = "proto3";

package ai.pipestream.repository.v1;

import "options/form_options.proto";
import "google/protobuf/any.proto";
import "google/protobuf/timestamp.proto";

message PipeDoc {
  option (ai.pipestream.forms.form_title) = "Document Editor";
  option (ai.pipestream.forms.form_description) = "Edit pipeline document metadata and content";
  option (ai.pipestream.forms.form_layout) = "vertical";
  option (ai.pipestream.forms.form_icon) = "mdi-file-document";

  string doc_id = 1 [
    (ai.pipestream.forms.ui_label) = "Document ID",
    (ai.pipestream.forms.ui_help) = "Unique identifier for this document",
    (ai.pipestream.forms.ui_readonly) = true,
    (ai.pipestream.forms.ui_order) = 1
  ];

  string title = 2 [
    (ai.pipestream.forms.ui_label) = "Title",
    (ai.pipestream.forms.ui_placeholder) = "Enter document title",
    (ai.pipestream.forms.ui_help) = "Document title for display and search",
    (ai.pipestream.forms.ui_order) = 2,
    (ai.pipestream.forms.ui_min_length) = 1,
    (ai.pipestream.forms.ui_max_length) = 200
  ];

  string body = 3 [
    (ai.pipestream.forms.ui_widget) = "textarea",
    (ai.pipestream.forms.ui_label) = "Content",
    (ai.pipestream.forms.ui_help) = "Main document content",
    (ai.pipestream.forms.ui_order) = 3,
    (ai.pipestream.forms.ui_min_length) = 0,
    (ai.pipestream.forms.ui_max_length) = 100000
  ];

  string original_mime_type = 4 [
    (ai.pipestream.forms.ui_label) = "MIME Type",
    (ai.pipestream.forms.ui_help) = "Original file MIME type",
    (ai.pipestream.forms.ui_readonly) = true,
    (ai.pipestream.forms.ui_order) = 4
  ];

  google.protobuf.Timestamp last_processed = 5 [
    (ai.pipestream.forms.ui_widget) = "datetime",
    (ai.pipestream.forms.ui_label) = "Last Processed",
    (ai.pipestream.forms.ui_readonly) = true,
    (ai.pipestream.forms.ui_hidden) = true  // Hidden by default
  ];

  google.protobuf.Any custom_data = 6 [
    (ai.pipestream.forms.ui_widget) = "dynamic",
    (ai.pipestream.forms.ui_label) = "Custom Data",
    (ai.pipestream.forms.ui_help) = "Type-specific custom data",
    (ai.pipestream.forms.any_resolver) = "apicurio",
    (ai.pipestream.forms.ui_order) = 6
  ];

  map<string, string> metadata = 7 [
    (ai.pipestream.forms.ui_widget) = "key-value-editor",
    (ai.pipestream.forms.ui_label) = "Metadata",
    (ai.pipestream.forms.ui_help) = "Additional metadata key-value pairs",
    (ai.pipestream.forms.ui_order) = 10
  ];

  repeated string tags = 8 [
    (ai.pipestream.forms.ui_widget) = "tag-input",
    (ai.pipestream.forms.ui_label) = "Tags",
    (ai.pipestream.forms.ui_help) = "Document tags for categorization",
    (ai.pipestream.forms.ui_order) = 11
  ];
}
```

**Example:** Module configuration with annotations

```protobuf
message ChunkerConfig {
  option (ai.pipestream.forms.form_title) = "Chunker Configuration";
  option (ai.pipestream.forms.form_description) = "Configure text chunking parameters";

  int32 chunk_size = 1 [
    (ai.pipestream.forms.ui_label) = "Chunk Size",
    (ai.pipestream.forms.ui_help) = "Maximum characters per chunk",
    (ai.pipestream.forms.ui_widget) = "slider",
    (ai.pipestream.forms.ui_min) = 100,
    (ai.pipestream.forms.ui_max) = 2000,
    (ai.pipestream.forms.ui_step) = 50
  ];

  int32 overlap = 2 [
    (ai.pipestream.forms.ui_label) = "Overlap",
    (ai.pipestream.forms.ui_help) = "Characters to overlap between chunks",
    (ai.pipestream.forms.ui_min) = 0,
    (ai.pipestream.forms.ui_max) = 500
  ];

  bool preserve_paragraphs = 3 [
    (ai.pipestream.forms.ui_label) = "Preserve Paragraphs",
    (ai.pipestream.forms.ui_help) = "Attempt to keep paragraph boundaries intact"
  ];

  ChunkingStrategy strategy = 4 [
    (ai.pipestream.forms.ui_widget) = "select",
    (ai.pipestream.forms.ui_label) = "Chunking Strategy"
  ];
}

enum ChunkingStrategy {
  FIXED_SIZE = 0;
  SENTENCE_BOUNDARY = 1;
  PARAGRAPH_BOUNDARY = 2;
  SEMANTIC = 3;
}
```

## 4. Generated Output

### Plugin Generates TypeScript with JSON Schemas

**Generated file:** `pipedoc_service_forms.ts`

```typescript
// Auto-generated by protoc-gen-jsonschema v1.0.0
// Source: repository/pipedoc/pipedoc_service.proto
// DO NOT EDIT

import type { JsonSchema } from '@ai-pipestream/protobuf-forms';

/**
 * JSON Schema for ai.pipestream.repository.v1.PipeDoc
 * Generated from proto annotations
 */
export const PipeDocFormSchema: JsonSchema = {
  type: "object",
  title: "Document Editor",
  description: "Edit pipeline document metadata and content",
  properties: {
    docId: {
      type: "string",
      title: "Document ID",
      description: "Unique identifier for this document",
      readOnly: true,
      "ui:order": 1
    },
    title: {
      type: "string",
      title: "Title",
      description: "Document title for display and search",
      "ui:placeholder": "Enter document title",
      "ui:order": 2,
      minLength: 1,
      maxLength: 200
    },
    body: {
      type: "string",
      title: "Content",
      description: "Main document content",
      "ui:widget": "textarea",
      "ui:order": 3,
      minLength: 0,
      maxLength: 100000
    },
    originalMimeType: {
      type: "string",
      title: "MIME Type",
      description: "Original file MIME type",
      readOnly: true,
      "ui:order": 4
    },
    customData: {
      type: "object",
      title: "Custom Data",
      description: "Type-specific custom data",
      "x-protobuf-type": "google.protobuf.Any",
      "x-type-resolver": "apicurio",
      "ui:widget": "dynamic",
      "ui:order": 6
    },
    metadata: {
      type: "object",
      title: "Metadata",
      description: "Additional metadata key-value pairs",
      additionalProperties: { type: "string" },
      "ui:widget": "key-value-editor",
      "ui:order": 10
    },
    tags: {
      type: "array",
      title: "Tags",
      description: "Document tags for categorization",
      items: { type: "string" },
      "ui:widget": "tag-input",
      "ui:order": 11
    }
  },
  required: ["title", "body"]
};

/**
 * JSON Schema for ai.pipestream.repository.v1.ChunkerConfig
 */
export const ChunkerConfigFormSchema: JsonSchema = {
  type: "object",
  title: "Chunker Configuration",
  description: "Configure text chunking parameters",
  properties: {
    chunkSize: {
      type: "integer",
      title: "Chunk Size",
      description: "Maximum characters per chunk",
      "ui:widget": "slider",
      minimum: 100,
      maximum: 2000,
      "ui:step": 50,
      default: 500
    },
    overlap: {
      type: "integer",
      title: "Overlap",
      description: "Characters to overlap between chunks",
      minimum: 0,
      maximum: 500,
      default: 50
    },
    preserveParagraphs: {
      type: "boolean",
      title: "Preserve Paragraphs",
      description: "Attempt to keep paragraph boundaries intact",
      default: true
    },
    strategy: {
      type: "string",
      title: "Chunking Strategy",
      enum: ["FIXED_SIZE", "SENTENCE_BOUNDARY", "PARAGRAPH_BOUNDARY", "SEMANTIC"],
      "ui:widget": "select",
      default: "FIXED_SIZE"
    }
  },
  required: ["chunkSize"]
};
```

## 5. Frontend Usage

### Simple Usage (Annotated Messages)

```vue
<template>
  <JsonForms
    :schema="PipeDocFormSchema"
    :data="pipeDoc"
    :renderers="vuetifyRenderers"
    @change="handleChange"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { JsonForms } from '@jsonforms/vue';
import { vuetifyRenderers } from '@jsonforms/vue-vuetify';
import { PipeDocFormSchema } from '@ai-pipestream/grpc-stubs/dist/repository/pipedoc/pipedoc_service_forms';
import { create } from '@bufbuild/protobuf';
import { PipeDocSchema } from '@ai-pipestream/grpc-stubs/dist/repository/pipedoc/pipedoc_service_pb';

// Create empty PipeDoc
const pipeDoc = ref(create(PipeDocSchema, {}));

function handleChange(event: any) {
  pipeDoc.value = event.data;
}
</script>
```

### Fallback for Unannotated Messages

For messages without annotations, fall back to runtime reflection:

```typescript
import { generateSchemaFromDescriptor } from '@ai-pipestream/protobuf-forms';
import { MyMessageSchema } from '@ai-pipestream/grpc-stubs/...';

// Runtime reflection-based generation
const schema = generateSchemaFromDescriptor(MyMessageSchema);
```

### Hybrid Approach

```typescript
import { PipeDocFormSchema } from '@ai-pipestream/grpc-stubs/.../pipedoc_service_forms';
import { MyMessageSchema } from '@ai-pipestream/grpc-stubs/.../my_service_pb';
import { generateSchemaFromDescriptor } from '@ai-pipestream/protobuf-forms';

// Try generated schema first, fallback to runtime
const schema = PipeDocFormSchema ?? generateSchemaFromDescriptor(MyMessageSchema);
```

## 6. Handling google.protobuf.Any Fields

### The Challenge

`Any` fields can contain any protobuf message type. To render them, you need:
1. The typeUrl (e.g., "type.googleapis.com/ai.pipestream.repository.v1.PipeDoc")
2. The schema for that specific type
3. Ability to unpack the Any value
4. Recursive rendering

### The Solution: Dynamic Any Field Component

```vue
<template>
  <div class="dynamic-any-field">
    <v-select
      v-if="!value || showTypeSelector"
      v-model="selectedType"
      :items="availableTypes"
      label="Select Type"
      @update:model-value="onTypeSelected"
    />

    <JsonForms
      v-if="unpacked && resolvedSchema"
      :schema="resolvedSchema"
      :data="unpacked"
      :renderers="renderers"
      @change="handleNestedChange"
    />

    <v-alert v-else-if="loading" type="info">
      Loading schema for {{ typeUrl }}...
    </v-alert>

    <v-alert v-else-if="error" type="error">
      {{ error }}
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { pack, unpack, create } from '@bufbuild/protobuf';
import type { Any } from '@bufbuild/protobuf/wkt';

const props = defineProps<{
  value: Any | null;
  resolver: 'apicurio' | 'registry';  // From annotation
}>();

const emit = defineEmits<{
  'update:value': [value: Any];
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const resolvedSchema = ref<JsonSchema | null>(null);
const unpacked = ref<any>(null);
const selectedType = ref<string>('');

// Parse type from typeUrl
const typeUrl = computed(() => props.value?.typeUrl || '');
const typeName = computed(() => {
  // "type.googleapis.com/ai.pipestream.repository.v1.PipeDoc"
  // → "ai.pipestream.repository.v1.PipeDoc"
  return typeUrl.value.split('/').pop() || '';
});

// Fetch schema for the type
async function loadSchema() {
  if (!typeName.value) return;

  loading.value = true;
  error.value = null;

  try {
    if (props.resolver === 'apicurio') {
      // Fetch from Apicurio via platform-registration
      const client = createPlatformRegistrationClient();
      const response = await client.getMessageSchema({
        typeName: typeName.value
      });
      resolvedSchema.value = JSON.parse(response.schemaJson);
    } else {
      // Fetch from local registry
      const schema = schemaRegistry.get(typeName.value);
      if (!schema) {
        throw new Error(`Schema not found for ${typeName.value}`);
      }
      resolvedSchema.value = generateSchemaFromDescriptor(schema);
    }

    // Unpack the Any value
    if (props.value) {
      unpacked.value = unpackAny(props.value, resolvedSchema.value);
    }
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

function handleNestedChange(event: any) {
  // Pack the updated value back into Any
  const packed = pack(resolvedSchema.value, event.data);
  emit('update:value', packed);
}

// Watch for typeUrl changes
watch(typeUrl, () => loadSchema(), { immediate: true });
</script>
```

### Plugin Generates Any Field Metadata

```typescript
// In generated schema
customData: {
  type: "object",
  title: "Custom Data",
  "x-protobuf-type": "google.protobuf.Any",
  "x-type-resolver": "apicurio",  // From annotation
  "ui:widget": "dynamic"
}
```

The DynamicAnyField component reads these metadata fields to know how to resolve and render the type.

## 7. Benefits Over Current Approach

### For Developers

| Current (Hardcoded) | Future (Plugin) |
|---------------------|-----------------|
| ❌ Manual schema for each type | ✅ Automatic from proto |
| ❌ Out of sync with proto | ✅ Always in sync |
| ❌ TypeScript only | ✅ Any language |
| ❌ No version tracking | ✅ Versioned with proto |
| ❌ Limited customization | ✅ Full control via annotations |

### For Platform

- ✅ **Scalability**: Works for any message automatically
- ✅ **Consistency**: Same annotations work everywhere
- ✅ **Maintainability**: Single source of truth
- ✅ **Flexibility**: Annotations optional, fallback to defaults
- ✅ **Performance**: Build-time generation, zero runtime cost

## 8. Fallback Strategy

The system supports **progressive enhancement**:

### Level 1: No Annotations (Automatic)
```protobuf
message MyMessage {
  string name = 1;
  int32 age = 2;
}
```
Plugin generates basic schema with defaults.

### Level 2: Partial Annotations (Selective)
```protobuf
message MyMessage {
  string name = 1 [(ui_label) = "Full Name"];
  int32 age = 2;  // Uses default
}
```
Annotated fields get custom rendering, others use defaults.

### Level 3: Full Annotations (Complete Control)
```protobuf
message MyMessage {
  option (form_title) = "User Profile";
  string name = 1 [(ui_label) = "Full Name", (ui_min_length) = 1];
  int32 age = 2 [(ui_min) = 0, (ui_max) = 150];
}
```
Full control over every aspect of the form.

## 9. Integration with Existing Systems

### Module Configuration

Modules can add annotations to their config messages:

```protobuf
message ParserConfig {
  option (form_title) = "Parser Configuration";

  ParserType type = 1 [(ui_widget) = "select"];
  bool extract_metadata = 2 [(ui_label) = "Extract Metadata"];
  int32 max_file_size_mb = 3 [(ui_min) = 1, (ui_max) = 100];
}
```

Platform-registration's `getModuleSchema()` would return the generated JSON Schema instead of requiring modules to provide it.

### PipeDoc Editing

Create PipeDoc editor component:

```vue
<template>
  <v-card>
    <v-card-title>Edit Document</v-card-title>
    <v-card-text>
      <JsonForms
        :schema="PipeDocFormSchema"
        :data="document"
        :renderers="vuetifyRenderers"
        @change="handleChange"
      />
    </v-card-text>
    <v-card-actions>
      <v-btn @click="save">Save</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { PipeDocFormSchema } from '@ai-pipestream/grpc-stubs/dist/repository/pipedoc/pipedoc_service_forms';
```

### Mapping Service

Field mapping UI can use generated schemas:

```typescript
// Get schemas for source and target types
const sourceSchema = await getSchemaForType(sourceTypeName);
const targetSchema = await getSchemaForType(targetTypeName);

// Render side-by-side field mapping UI
<FieldMapper
  :source-schema="sourceSchema"
  :target-schema="targetSchema"
  @mapping-created="handleMapping"
/>
```

## 10. Implementation Timeline

See platform-libraries Issue #7 for detailed implementation plan:
- https://github.com/ai-pipestream/platform-libraries/issues/7

### Estimated Phases

1. **Plugin Development** - 1-2 weeks
   - Create plugin package
   - Implement code generator
   - Test with sample protos

2. **Integration** - 1 week
   - Update buf.gen.yaml
   - Regenerate grpc-stubs
   - Publish updated package

3. **Frontend Adoption** - 1-2 weeks
   - Update form components
   - Create DynamicAnyField
   - Migrate existing forms

## 11. Related Issues

- **Plugin implementation**: https://github.com/ai-pipestream/platform-libraries/issues/7
- **Frontend integration**: TBD (after plugin complete)

## 12. Related Documentation

- **Protobuf_Forms-UPDATED.md** - Current implementation
- **Module_UI_Rendering-UPDATED.md** - Module configuration system
- **GRPC_Client_Examples-UPDATED.md** - gRPC patterns
