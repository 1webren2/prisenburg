#include "Character.h"

#include <iostream>

Character::Character(const std::string& name, int age, const std::string& identity)
    : name_(name), age_(age), identity_(identity), affection_(0) {}

void Character::changeAffection(int delta) {
    affection_ += delta;
    if (affection_ > 100) {
        affection_ = 100;
    } else if (affection_ < 0) {
        affection_ = 0;
    }
}

void Character::setAffection(int value) {
    affection_ = value;
    if (affection_ > 100) {
        affection_ = 100;
    } else if (affection_ < 0) {
        affection_ = 0;
    }
}

void Character::output() const {
    std::cout << "Character_name: " << name_ << std::endl;
    std::cout << "Character_age: " << age_ << std::endl;
    std::cout << "Character_identity: " << identity_ << std::endl;
    std::cout << "Character_affection: " << affection_ << std::endl;
}
