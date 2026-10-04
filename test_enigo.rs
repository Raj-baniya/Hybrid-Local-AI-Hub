use enigo::{Enigo, Mouse, Keyboard, Settings, Direction, MouseButton, Coordinate};
fn main() {
    let mut enigo = Enigo::new(&Settings::default()).unwrap();
    enigo.move_mouse(10, 10, Coordinate::Abs).unwrap();
    enigo.button(MouseButton::Left, Direction::Click).unwrap();
    enigo.text("Hello").unwrap();
}