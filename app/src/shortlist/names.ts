export function fullName(name: string, surname: string) {
  return surname.trim() ? `${name} ${surname.trim()}` : name
}
