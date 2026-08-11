export interface ProtoMessage {
  [tag: number]: ProtoValue
}

type ProtoValue = string | boolean | number | EnumValue | DoubleValue | ProtoMessage | ProtoValue[]

class EnumValue {
  readonly value: number

  constructor(value: number) {
    this.value = value
  }
}

class DoubleValue {
  readonly value: number

  constructor(value: number) {
    this.value = value
  }
}

export function protoEnum(value: number): EnumValue {
  return new EnumValue(value)
}

export function protoDouble(value: number): DoubleValue {
  return new DoubleValue(value)
}

function serializeField(tag: number, value: ProtoValue): { count: number; text: string } {
  if (Array.isArray(value)) {
    return value.reduce<{ count: number; text: string }>(
      (result, entry) => {
        const serialized = serializeField(tag, entry)
        result.count += serialized.count
        result.text += serialized.text
        return result
      },
      { count: 0, text: '' },
    )
  }

  if (value instanceof EnumValue) return { count: 1, text: `!${tag}e${value.value}` }
  if (value instanceof DoubleValue) return { count: 1, text: `!${tag}d${value.value}` }
  if (typeof value === 'string') return { count: 1, text: `!${tag}s${value}` }
  if (typeof value === 'boolean') return { count: 1, text: `!${tag}b${value ? 1 : 0}` }
  if (typeof value === 'number') return { count: 1, text: `!${tag}i${value}` }

  const child = serializeMessage(value)
  return {
    count: child.count + 1,
    text: `!${tag}m${child.count}${child.text}`,
  }
}

function serializeMessage(fields: ProtoMessage): { count: number; text: string } {
  return Object.entries(fields).reduce<{ count: number; text: string }>(
    (result, [tag, value]) => {
      const serialized = serializeField(Number(tag), value)
      result.count += serialized.count
      result.text += serialized.text
      return result
    },
    { count: 0, text: '' },
  )
}

export function toProtobufUrl(fields: ProtoMessage): string {
  return serializeMessage(fields).text
}

export type { ProtoValue }
