// represents a successful operation
export type Ok<V> = {
	_tag: "ok";
	value: V;
};

// represents a failed operation
export type Err = {
	_tag: "err";
	error: Error;
};

export type Result<V> = Ok<V> | Err;

// Some convenience functions for readability:

export function ok<V>(value: V): Ok<V> {
	return { _tag: "ok", value };
}

export function err(error: Error): Err {
	return { _tag: "err", error };
}

export function isOk<T>(r: Result<T>): r is Ok<T> {
	return r._tag == "ok";
}

export function isErr<T>(r: Result<T>): r is Err {
	return r._tag == "err";
}

export type GenericFunction = (...args: any) => any;

export function WrapFault<F extends GenericFunction>(
	job: F,
	...params: Parameters<F>
): Result<ReturnType<F>> {
	try {
		return ok(job(...params));
	} catch (error) {
		if (error instanceof Error) {
			return err(error);
		} else {
			return err(new Error(error as any));
		}
	}
}

export function Match<Value, Ret1, Ret2>(
	result: Result<Value>,
	functs: { onOk: (value: Value) => Ret1; onErr: (err: Error) => Ret2 },
): Ret1 | Ret2 {
	if (isOk(result)) {
		return functs.onOk(result.value);
	} else {
		return functs.onErr(result.error);
	}
}

export function FlatMap<OriginalValue, TransformedValue>(
	maybe: Result<OriginalValue>,
	transform: (val: OriginalValue) => TransformedValue,
): Result<TransformedValue> {
	if (isOk(maybe)) {
		return ok(transform(maybe.value));
	} else {
		return maybe;
	}
}

/*
export function failable(x: number, y: string): number {
	if (y == "failure") {
		throw new Error("ugh...");
	} else {
		return x;
	}
}

const result = WrapFault(failable, 1, "failure");

Match(
	result,
	{
		onOk(v) {
			console.log(v);
		},
		onErr(e) {
			console.log(e.stack, e.name);
		},
	},
);
*/

export const MapError = <V>(r: Result<V>, func: (err: Error) => Result<V>) =>
	Match(r, {
		onOk(_) {
			return r;
		},
		onErr: func,
	});

/*
MapError(result, (e) => {
	console.log(e);
	return err(e);
});
*/
