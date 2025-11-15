# Protobuf Forms - Current Implementation

## 1. Overview

The `@ai-pipestream/protobuf-forms` package provides utilities for converting protobuf message schemas to JSON Schema format for use with form rendering libraries like JSONForms.

**Current Status:** Basic implementation with hardcoded conversions for specific message types.

**Package Location:** `packages/protobuf-forms/`

**Published:** `@ai-pipestream/protobuf-forms` on npm

## 2. Current Architecture

The package consists of three main components:

### 2.1. ProtobufToJsonSchemaConverter

**Location:** `src/converter.ts`

**Purpose:** Converts protobuf message schemas (GenMessage) to JSON Schema objects.

**Current Implementation:** Hardcoded schemas for known types with fallback:

```typescript
import { create, Message } from '@bufbuild/protobuf';
import type { GenMessage } from '@bufbuild/protobuf/codegenv2';

export class ProtobufToJsonSchemaConverter {
  convertMessageSchema<T extends Message>(messageSchema: GenMessage<T>): JsonSchema {
    const schema: JsonSchema = {
      type: 'object',
      properties: {},
      required: [],
      title: this.extractMessageName(messageSchema.typeName)
    };

    // Hardcoded schemas for known types
    if (messageSchema.typeName.includes('PipeDoc')) {
      schema.properties = {
        docId: { type: 'string', title: 'Document ID' },
        title: { type: 'string', title: 'Title' },
        body: { type: 'string', title: 'Body', 'ui:widget': 'textarea' },
        originalMimeType: { type: 'string', title: 'Original MIME Type' },
        lastProcessed: { type: 'string', title: 'Last Processed', format: 'date-time' },
        metadata: {
          type: 'object',
          title: 'Metadata',
          additionalProperties: { type: 'string' }
        }
      };
    } else if (messageSchema.typeName.includes('ApplyMappingRequest')) {
      // ... hardcoded mapping request schema
    } else {
      // Generic fallback
      schema.properties = {
        data: {
          type: 'object',
          title: 'Data',
          description: 'Message data'
        }
      };
    }

    return schema;
  }
}
```

**Supported Types:**
- `PipeDoc` - Document message schema
- `ApplyMappingRequest` - Mapping request schema
- Generic fallback for unknown types

### 2.2. ProtobufSchemaLoader

**Location:** `src/loader.ts`

**Purpose:** Registry for message schemas with lookup capabilities.

```typescript
export class ProtobufSchemaLoader {
  private converter: ProtobufToJsonSchemaConverter;
  private messageRegistry: Map<string, GenMessage<any>>;

  constructor(options: LoaderOptions = {}) {
    this.converter = new ProtobufToJsonSchemaConverter(options);
    this.messageRegistry = new Map();
  }

  /**
   * Register a message type
   */
  registerMessage(name: string, schema: GenMessage<any>): void {
    this.messageRegistry.set(name, schema);
  }

  /**
   * Get JSON Schema for a message type
   */
  getMessageSchema(messageType: string): JsonSchema {
    const messageSchema = this.messageRegistry.get(messageType);

    if (!messageSchema) {
      return this.createBasicSchema(messageType);
    }

    return this.converter.convertMessageSchema(messageSchema);
  }

  /**
   * List all registered message types
   */
  getAvailableMessageTypes(): string[] {
    return Array.from(this.messageRegistry.keys());
  }
}
```

**Usage:**

```typescript
import { ProtobufSchemaLoader } from '@ai-pipestream/protobuf-forms';
import { PipeDocSchema } from '@ai-pipestream/grpc-stubs/dist/repository/pipedoc/pipedoc_service_pb';

const loader = new ProtobufSchemaLoader();

// Register message types
loader.registerMessage('PipeDoc', PipeDocSchema);
loader.registerMessage('ai.pipestream.repository.v1.PipeDoc', PipeDocSchema);

// Get JSON Schema
const schema = loader.getMessageSchema('PipeDoc');
```

### 2.3. UI Hints

**Location:** `converter.ts` - `addUiHints()` method

Automatically adds UI hints for better form rendering:

```typescript
private addUiHints(schema: JsonSchema): void {
  if (schema.properties) {
    Object.entries(schema.properties).forEach(([fieldName, fieldSchema]) => {
      // Textarea for fields named 'body'
      if (fieldSchema.type === 'string' && fieldName.toLowerCase().includes('body')) {
        fieldSchema['ui:widget'] = 'textarea';
        fieldSchema['ui:options'] = { rows: 5 };
      }

      // Array controls
      if (fieldSchema.type === 'array') {
        fieldSchema['ui:options'] = { addable: true, removable: true };
      }
    });
  }
}
```

## 3. Current Usage

### In Module Configuration

Currently **NOT used** - modules use JSON Schema directly from their `getServiceRegistration()` RPC.

### Potential Use Cases

The package could be used for:

1. **PipeDoc Editing Forms**
   ```typescript
   import { ProtobufSchemaLoader } from '@ai-pipestream/protobuf-forms';
   import { PipeDocSchema } from '@ai-pipestream/grpc-stubs/...';

   const loader = new ProtobufSchemaLoader();
   loader.registerMessage('PipeDoc', PipeDocSchema);
   const schema = loader.getMessageSchema('PipeDoc');

   // Use with JSONForms
   <JsonForms :schema="schema" :data="pipeDocData" />
   ```

2. **Dynamic Message Editors**
   - Admin tools for editing any protobuf message
   - Mapping service field editors
   - Configuration editors

3. **Developer Tools**
   - Message inspectors
   - Data transformation UIs

## 4. Limitations

The current implementation has significant limitations:

### Hardcoded Schemas
- ❌ Only works for explicitly hardcoded message types
- ❌ Must manually update for proto changes
- ❌ Doesn't scale to new message types
- ❌ Out of sync with proto definitions

### No Descriptor Introspection
- ❌ Doesn't use available GenMessage field descriptors
- ❌ Misses field metadata (optional, repeated, etc.)
- ❌ Can't handle arbitrary message types

### No Custom Annotations
- ❌ UI hints are hardcoded, not from proto
- ❌ Can't customize per-field rendering
- ❌ Limited control over form behavior

### No Any Field Support
- ❌ `google.protobuf.Any` treated as generic object
- ❌ No type resolution or unpacking
- ❌ Can't render nested Any types

## 5. Dependencies

```json
{
  "dependencies": {
    "@bufbuild/protobuf": "catalog:",
    "@connectrpc/connect": "catalog:",
    "@ai-pipestream/grpc-stubs": "catalog:"
  }
}
```

**Used by:**
- Potentially by form rendering components (currently unused)
- Could be used in shared-components package

## 6. Future Direction

The package is a foundation for more sophisticated form generation. See **Protobuf_Forms_Future.md** for the planned buf plugin-based approach that will:

- Generate JSON Schemas automatically from proto definitions
- Support custom proto annotations for UI hints
- Handle Any fields with dynamic type resolution
- Scale to any message type without manual maintenance

## 7. Related Documentation

- **Protobuf_Forms_Future.md** - Future vision with buf plugin approach
- **Module_UI_Rendering-UPDATED.md** - How module configs currently work (JSON Schema from modules)
- **GRPC_Client_Examples-UPDATED.md** - gRPC usage patterns

## 8. Migration Note

When the buf plugin (Issue #7) is implemented, this package will:
- Use generated schemas instead of hardcoded conversions
- Provide runtime fallback for messages without generated schemas
- Support dynamic Any field resolution
- Become a thin wrapper around generated schemas + dynamic utilities
