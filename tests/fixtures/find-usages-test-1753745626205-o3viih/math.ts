export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function calculate(x: number, y: number): number {
  const sum = add(x, y);
  const product = multiply(x, y);
  return sum + product;
}

export class Calculator {
  add(a: number, b: number): number {
    return add(a, b);
  }

  multiply(a: number, b: number): number {
    return multiply(a, b);
  }

  calculate(x: number, y: number): number {
    return calculate(x, y);
  }
}