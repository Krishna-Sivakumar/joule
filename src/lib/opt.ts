import { R } from "../lib";

// represents something
export type Some<V> = {
	_tag: "some";
	value: V;
};

// represents nothing
export type None = {
	_tag: "none";
};

export type Option<V> = Some<V> | None

export function some<V>(value: V): Option<V> {
	return { _tag: "some", value }
}

export function none<V>(): Option<V> {
	return { _tag: "none" }
}

export function isSome<V>(maybe: Option<V>): maybe is Some<V> {
	return maybe._tag == "some"
}

export function isNone<V>(maybe: Option<V>): maybe is None {
	return maybe._tag == "none"
}

export function FlatMap<OriginalValue, TransformedValue>(
	maybe: Option<OriginalValue>, transform: (val: OriginalValue) => TransformedValue
): Option<TransformedValue> {
	switch (maybe._tag) {
		case "some":
			return some(transform(maybe.value))
		case "none":
			return maybe
	}
}

export function Bind<OriginalValue, TransformedValue>(
	maybe: Option<OriginalValue>, transform: (val: OriginalValue) => Option<TransformedValue>): Option<TransformedValue> {
	switch (maybe._tag) {
		case "some":
			return transform(maybe.value)
		case "none":
			return maybe
	}
}

export function Unwrap<V>(maybe: Option<V>): V {
	switch (maybe._tag) {
		case "some":
			return maybe.value
		case "none":
			throw new Error(`Option unwrap failed: option was None`)
	}
}

export function UnwrapDefault<V>(maybe: Option<V>, default_: V): V {
	switch (maybe._tag) {
		case "some":
			return maybe.value
		case "none":
			return default_
	}
}

export function Match<V, Ret1, Ret2>(
	maybe: Option<V>,
	functs: { onSome: (value: V) => Ret1, onNone: () => Ret2 }
): Ret1 | Ret2 {
	switch (maybe._tag) {
		case "some":
			return functs.onSome(maybe.value)
		case "none":
			return functs.onNone()
	}
}

export function Optionalize<V>(value: V | null | undefined): Option<V> {
	switch (value) {
		case null:
			return none()
		case undefined:
			return none()
		default:
			return some(value)
	}
}

export function Resultize<V>(maybe: Option<V>): R.Result<V> {
	return Match(maybe, {
		onSome(value) {
			return R.ok(value)
		},
		onNone() {
			return R.err(new Error("Option is empty."))
		},
	})
}

